import { App, LogLevel } from '@slack/bolt';
import type { GenericMessageEvent, BotMessageEvent } from '@slack/types';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, TRIGGER_PATTERN } from '../config.js';

// Persist bot-participated thread IDs so restarts don't break auto-trigger.
// Keyed by jid → array of { ts, savedAt }. Pruned on load (>7 days old).
const BOT_THREADS_PATH = path.join(DATA_DIR, 'bot-threads.json');
const BOT_THREADS_TTL_DAYS = 7;
import { updateChatName } from '../db.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

// Emoji reaction added to the user's message while the bot is processing.
// Requires reactions:write scope. Visible from the channel without opening the thread.
const THINKING_REACTION = 'hourglass_flowing_sand';

// Slack's chat.postMessage API limits text to ~4000 characters per call.
// Messages exceeding this are split into sequential chunks.
const MAX_MESSAGE_LENGTH = 4000;

// The message subtypes we process. Bolt delivers all subtypes via app.event('message');
// we filter to regular messages (GenericMessageEvent, subtype undefined) and bot messages
// (BotMessageEvent, subtype 'bot_message') so we can track our own output.
type HandledMessageEvent = GenericMessageEvent | BotMessageEvent;

export interface SlackChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class SlackChannel implements Channel {
  name = 'slack';

  private app: App;
  private botUserId: string | undefined;
  private botId: string | undefined; // bot_id (B-prefixed) — distinct from botUserId (U-prefixed)
  private connected = false;
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private userNameCache = new Map<string, string>();

  private opts: SlackChannelOpts;

  // The thread_ts to reply into for each jid, with the time it was set.
  // Expires after THREAD_CONTEXT_TTL_MS so IPC/scheduled messages don't
  // piggyback on a stale thread from an earlier conversation.
  private activeThreadTs = new Map<string, { ts: string; setAt: number }>();
  private static readonly THREAD_CONTEXT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /** Get the active thread_ts for a jid, or undefined if expired. */
  private getActiveThread(jid: string): string | undefined {
    const entry = this.activeThreadTs.get(jid);
    if (!entry) return undefined;
    if (Date.now() - entry.setAt > SlackChannel.THREAD_CONTEXT_TTL_MS) {
      this.activeThreadTs.delete(jid);
      return undefined;
    }
    return entry.ts;
  }

  // The ts of the latest inbound user message per jid.
  // Used to add/remove a thinking emoji reaction while processing.
  private lastUserMessageTs = new Map<string, string>();

  // Whether the assistant.threads.setStatus API is available per channel (detected at runtime).
  // undefined = not yet tested, true = works, false = not available (fall back to post/delete).
  // Keyed by channelId because the API only works in AI-app DM threads, not regular channels.
  private assistantStatusAvailable = new Map<string, boolean>();

  // Threads where the bot has previously replied, keyed by jid → Set<thread_ts>.
  // Used to auto-trigger responses when the user replies to an existing bot thread
  // without @mentioning the bot.
  private botParticipatedThreads = new Map<string, Set<string>>();

  // Thinking indicator state.
  // When using assistant API: stores 'assistant:<thread_ts>' so setTyping(false) knows to clear it.
  // When using post/delete fallback: stores the ts of the posted "thinking" message.
  private thinkingTs = new Map<string, string>();

  constructor(opts: SlackChannelOpts) {
    this.opts = opts;

    // Read tokens from .env (not process.env — keeps secrets off the environment
    // so they don't leak to child processes, matching NanoClaw's security pattern)
    const env = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
    const botToken = env.SLACK_BOT_TOKEN;
    const appToken = env.SLACK_APP_TOKEN;

    if (!botToken || !appToken) {
      throw new Error(
        'SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in .env',
      );
    }

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.ERROR,
    });

    this.setupEventHandlers();
    this.loadBotThreads();
  }

  /** Load persisted bot-thread participation from disk, pruning entries older than TTL. */
  private loadBotThreads(): void {
    try {
      const raw = JSON.parse(
        fs.readFileSync(BOT_THREADS_PATH, 'utf8'),
      ) as Record<string, Array<{ ts: string; savedAt: number }>>;
      const cutoff = Date.now() - BOT_THREADS_TTL_DAYS * 86400_000;
      for (const [jid, entries] of Object.entries(raw)) {
        const fresh = entries.filter((e) => e.savedAt > cutoff);
        if (fresh.length > 0) {
          this.botParticipatedThreads.set(jid, new Set(fresh.map((e) => e.ts)));
        }
      }
    } catch {
      // File doesn't exist yet — fine, start empty
    }
  }

  /** Persist bot-thread participation to disk. */
  private saveBotThreads(): void {
    try {
      const now = Date.now();
      const out: Record<string, Array<{ ts: string; savedAt: number }>> = {};
      for (const [jid, tsSet] of this.botParticipatedThreads.entries()) {
        out[jid] = Array.from(tsSet).map((ts) => ({ ts, savedAt: now }));
      }
      const tmp = BOT_THREADS_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
      fs.renameSync(tmp, BOT_THREADS_PATH);
    } catch (err) {
      logger.warn({ err }, 'Failed to persist bot-threads');
    }
  }

  /** Add a thread_ts to the set of threads the bot has participated in, and persist. */
  private trackBotThread(jid: string, threadTs: string): void {
    if (!this.botParticipatedThreads.has(jid)) {
      this.botParticipatedThreads.set(jid, new Set());
    }
    this.botParticipatedThreads.get(jid)!.add(threadTs);
    this.saveBotThreads();
  }

  private setupEventHandlers(): void {
    // Use app.event('message') instead of app.message() to capture all
    // message subtypes including bot_message (needed to track our own output)
    this.app.event('message', async ({ event }) => {
      // Bolt's event type is the full MessageEvent union (17+ subtypes).
      // We handle: regular messages (no subtype), bot_message, slack_audio, and file_share.
      // Voice notes from the Slack mobile app arrive as file_share (with files[].subtype = 'slack_audio').
      const subtype = (event as { subtype?: string }).subtype;
      logger.info(
        {
          subtype,
          channel: (event as { channel?: string }).channel,
          hasFiles: !!(event as { files?: unknown[] }).files?.length,
        },
        'Slack message event received',
      );
      const ALLOWED_SUBTYPES = new Set([
        'bot_message',
        'slack_audio',
        'file_share',
      ]);
      if (subtype && !ALLOWED_SUBTYPES.has(subtype)) return;

      // After filtering, event is either GenericMessageEvent or BotMessageEvent
      const msg = event as HandledMessageEvent;

      // Check for attached files (e.g. voice notes, images)
      const files = (
        event as {
          files?: Array<{
            url_private?: string;
            mimetype?: string;
            name?: string;
            subtype?: string;
            title?: string;
          }>;
        }
      ).files;

      // Extract text from Slack attachments/blocks when msg.text is empty.
      // Many bots (snyk-bot, GitHub, etc.) post via rich attachments with no plain text.
      const rawEvent = event as {
        attachments?: Array<{ text?: string; fallback?: string; pretext?: string }>;
        blocks?: Array<{
          type: string;
          text?: { text?: string };
          elements?: Array<{ type: string; text?: string; elements?: Array<{ text?: string }> }>;
        }>;
      };
      let fallbackText: string | undefined;
      if (!msg.text) {
        const parts: string[] = [];
        if (rawEvent.attachments) {
          for (const att of rawEvent.attachments) {
            if (att.text) parts.push(att.text);
            else if (att.fallback) parts.push(att.fallback);
            else if (att.pretext) parts.push(att.pretext);
          }
        }
        if (parts.length === 0 && rawEvent.blocks) {
          for (const block of rawEvent.blocks) {
            if (block.text?.text) parts.push(block.text.text);
            else if (block.elements) {
              for (const el of block.elements) {
                if (el.text) parts.push(el.text);
                else if (el.elements) {
                  for (const sub of el.elements) {
                    if (sub.text) parts.push(sub.text);
                  }
                }
              }
            }
          }
        }
        if (parts.length > 0) fallbackText = parts.join('\n');
      }

      // Require text OR attached files — drop empty messages
      if (!msg.text && !fallbackText && (!files || files.length === 0)) return;

      const jid = `slack:${msg.channel}`;
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      const isGroup = msg.channel_type !== 'im';

      // Always report metadata for group discovery
      this.opts.onChatMetadata(jid, timestamp, undefined, 'slack', isGroup);

      // Only deliver full messages for registered groups
      const groups = this.opts.registeredGroups();
      if (!groups[jid]) return;

      // Only treat messages from OUR bot as bot messages.
      // Other bots (snyk-bot, etc.) should appear as regular messages
      // so the agent can see and respond to them.
      const isBotMessage =
        (msg.bot_id != null && msg.bot_id === this.botId) ||
        msg.user === this.botUserId;

      // Track the thread to reply into: use the existing thread or start one
      // from this message's ts. Updated on every non-bot inbound message so
      // follow-up messages in the same thread continue in that thread.
      if (!isBotMessage) {
        const threadTs = (msg as { thread_ts?: string }).thread_ts ?? msg.ts;
        this.activeThreadTs.set(jid, { ts: threadTs, setAt: Date.now() });
        this.lastUserMessageTs.set(jid, msg.ts);
      }

      // Track threads where the bot has replied so we can auto-trigger
      // responses to thread replies without an @mention.
      // Note: BotMessageEvent has bot_id but not user, so check isBotMessage only.
      if (isBotMessage) {
        const threadTs = (msg as { thread_ts?: string }).thread_ts;
        if (threadTs) {
          if (!this.botParticipatedThreads.has(jid)) {
            this.botParticipatedThreads.set(jid, new Set());
          }
          this.botParticipatedThreads.get(jid)!.add(threadTs);
        }
      }

      let senderName: string;
      if (isBotMessage) {
        senderName = ASSISTANT_NAME;
      } else {
        senderName =
          (msg.user ? await this.resolveUserName(msg.user) : undefined) ||
          msg.user ||
          'unknown';
      }

      // Translate Slack <@UBOTID> mentions into TRIGGER_PATTERN format.
      // Slack encodes @mentions as <@U12345>, which won't match TRIGGER_PATTERN
      // (e.g., ^@<ASSISTANT_NAME>\b), so we prepend the trigger when the bot is @mentioned.
      // Also auto-trigger when the user replies to a thread where the bot has already replied
      // (no @mention needed — they're already in a conversation with the bot).
      let content = msg.text || fallbackText || '';
      if (!isBotMessage && !TRIGGER_PATTERN.test(content)) {
        const messageThreadTs = (msg as { thread_ts?: string }).thread_ts;
        const isMentioned =
          this.botUserId && content.includes(`<@${this.botUserId}>`);
        const isThreadReplyWithBot =
          messageThreadTs &&
          this.botParticipatedThreads.get(jid)?.has(messageThreadTs);

        if (isMentioned || isThreadReplyWithBot) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Transcribe audio/voice files and download images so the agent can analyze them.
      // Slack voice notes: message subtype = 'file_share', file.subtype = 'slack_audio', mimetype = 'video/mp4'
      if (!isBotMessage && files && files.length > 0) {
        const groupFolder = this.opts.registeredGroups()[jid]?.folder;
        for (const file of files) {
          const isAudio =
            file.url_private &&
            (file.subtype === 'slack_audio' ||
              file.mimetype?.startsWith('audio/') ||
              file.mimetype?.startsWith('video/')); // Slack sends voice memos as video/mp4
          const isImage =
            file.url_private && file.mimetype?.startsWith('image/');
          if (isAudio) {
            const transcript = await this.transcribeSlackAudio(
              file.url_private!,
            );
            if (transcript) {
              content = content ? `${transcript}\n${content}` : transcript;
            }
          } else if (isImage && groupFolder) {
            const imagePath = await this.downloadSlackImage(
              file.url_private!,
              file.name || `image-${Date.now()}.jpg`,
              groupFolder,
            );
            if (imagePath) {
              // imagePath is the container-visible path under /workspace/ipc/
              const imageNote = `[Image attached: ${imagePath} — use the Read tool to view and analyze it]`;
              content = content ? `${content}\n${imageNote}` : imageNote;
            }
          }
        }
      }

      // After transcription, drop if still empty (e.g. non-audio file with no text)
      if (!content) return;

      this.opts.onMessage(jid, {
        id: msg.ts,
        chat_jid: jid,
        sender: msg.user || msg.bot_id || '',
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: isBotMessage,
        is_bot_message: isBotMessage,
      });
    });
  }

  /** Download a Slack-hosted audio file and transcribe it via OpenAI Whisper. */
  private async transcribeSlackAudio(fileUrl: string): Promise<string | null> {
    const env = readEnvFile(['OPENAI_API_KEY', 'SLACK_BOT_TOKEN']);
    const openaiKey = env.OPENAI_API_KEY;
    const botToken = env.SLACK_BOT_TOKEN;

    if (!openaiKey) {
      logger.warn('OPENAI_API_KEY not set — cannot transcribe voice message');
      return '[Voice message — transcription unavailable: set OPENAI_API_KEY in .env]';
    }

    try {
      // Download the audio file using the bot token for auth
      const downloadRes = await fetch(fileUrl, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!downloadRes.ok) {
        throw new Error(`Slack download failed: ${downloadRes.status}`);
      }
      const audioBuffer = Buffer.from(await downloadRes.arrayBuffer());

      // Determine a reasonable file extension for Whisper
      // Slack voice memos are typically M4A wrapped in a MP4 container
      const ext = fileUrl.includes('.')
        ? fileUrl.split('.').pop()!.split('?')[0]
        : 'mp4';

      // Send to OpenAI Whisper
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      formData.append('file', blob, `voice.${ext}`);
      formData.append('model', 'whisper-1');

      const whisperRes = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: formData,
        },
      );

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        throw new Error(`Whisper API error ${whisperRes.status}: ${errText}`);
      }

      const result = (await whisperRes.json()) as { text: string };
      logger.info({ fileUrl }, 'Voice message transcribed');
      return `[Voice message]: ${result.text}`;
    } catch (err) {
      logger.error({ fileUrl, err }, 'Failed to transcribe voice message');
      return '[Voice message — transcription failed]';
    }
  }

  /**
   * Download a Slack-hosted image and save it to the IPC directory so the agent can
   * read it via the Read tool (which supports multimodal image content).
   * Returns the container-visible path (e.g. /workspace/ipc/images/foo.jpg) or null on error.
   */
  private async downloadSlackImage(
    fileUrl: string,
    filename: string,
    groupFolder: string,
  ): Promise<string | null> {
    const env = readEnvFile(['SLACK_BOT_TOKEN']);
    const botToken = env.SLACK_BOT_TOKEN;

    try {
      const downloadRes = await fetch(fileUrl, {
        headers: { Authorization: `Bearer ${botToken}` },
      });
      if (!downloadRes.ok) {
        throw new Error(`Slack image download failed: ${downloadRes.status}`);
      }
      const imageBuffer = Buffer.from(await downloadRes.arrayBuffer());

      // Save to the group's IPC images dir — mounted into the container at /workspace/ipc/
      const imagesDir = path.join(DATA_DIR, 'ipc', groupFolder, 'images');
      fs.mkdirSync(imagesDir, { recursive: true });

      // Sanitize filename: keep only safe characters
      const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const destFilename = `${Date.now()}-${safe}`;
      const destPath = path.join(imagesDir, destFilename);
      fs.writeFileSync(destPath, imageBuffer);

      logger.info(
        { fileUrl, destPath },
        'Slack image saved for agent analysis',
      );
      // Return the container-visible path
      return `/workspace/ipc/images/${destFilename}`;
    } catch (err) {
      logger.error({ fileUrl, err }, 'Failed to download Slack image');
      return null;
    }
  }

  async connect(): Promise<void> {
    await this.app.start();

    // Get bot's own user ID for self-message detection.
    // Resolve this BEFORE setting connected=true so that messages arriving
    // during startup can correctly detect bot-sent messages.
    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id as string;
      this.botId = auth.bot_id as string | undefined;
      logger.info({ botUserId: this.botUserId, botId: this.botId }, 'Connected to Slack');
    } catch (err) {
      logger.warn({ err }, 'Connected to Slack but failed to get bot user ID');
    }

    this.connected = true;

    // Flush any messages queued before connection
    await this.flushOutgoingQueue();

    // Sync channel names on startup
    await this.syncChannelMetadata();
  }

  async sendMessage(jid: string, text: string, opts?: { noThread?: boolean }): Promise<void> {
    const channelId = jid.replace(/^slack:/, '');

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text });
      logger.info(
        { jid, queueSize: this.outgoingQueue.length },
        'Slack disconnected, message queued',
      );
      return;
    }

    try {
      const threadTs = opts?.noThread ? undefined : this.getActiveThread(jid);
      // Slack limits messages to ~4000 characters; split if needed
      let postedTs: string | undefined;
      if (text.length <= MAX_MESSAGE_LENGTH) {
        const res = await this.app.client.chat.postMessage({
          channel: channelId,
          text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        postedTs = res.ts as string | undefined;
      } else {
        for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
          const res = await this.app.client.chat.postMessage({
            channel: channelId,
            text: text.slice(i, i + MAX_MESSAGE_LENGTH),
            ...(threadTs ? { thread_ts: threadTs } : {}),
          });
          // Only capture ts of the first chunk (that's the thread anchor)
          if (i === 0) postedTs = res.ts as string | undefined;
        }
      }
      // Track which threads the bot has posted into so user replies auto-trigger.
      // For top-level posts (no threadTs), the returned ts becomes the thread anchor.
      // For threaded replies, the existing threadTs is the anchor.
      // Both are persisted to disk so restarts don't break auto-trigger.
      const anchorTs = threadTs ?? postedTs;
      if (anchorTs) {
        this.trackBotThread(jid, anchorTs);
      }
      logger.info({ jid, length: text.length }, 'Slack message sent');
    } catch (err) {
      this.outgoingQueue.push({ jid, text });
      logger.warn(
        { jid, err, queueSize: this.outgoingQueue.length },
        'Failed to send Slack message, queued',
      );
    }
  }

  async sendMedia(
    jid: string,
    filePath: string,
    filename?: string,
  ): Promise<void> {
    const channelId = jid.replace(/^slack:/, '');
    const threadTs = this.getActiveThread(jid);
    const fname = filename || path.basename(filePath);

    try {
      const fileBuffer = fs.readFileSync(filePath);
      await this.app.client.files.uploadV2({
        channel_id: channelId,
        filename: fname,
        file: fileBuffer,
        // thread_ts must be string if present; cast via record to satisfy the union type
        ...(threadTs
          ? ({ thread_ts: threadTs } as Record<string, unknown>)
          : {}),
      } as Parameters<typeof this.app.client.files.uploadV2>[0]);
      logger.info({ jid, filePath, fname }, 'Slack media uploaded');
    } catch (err) {
      logger.error({ jid, filePath, err }, 'Failed to upload Slack media');
      throw err;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    await this.app.stop();
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const channelId = jid.replace(/^slack:/, '');
    const threadTs = this.getActiveThread(jid);
    // DM channels have IDs starting with 'D'. Regular channels (C/G) are group chats.
    const isDmChannel = channelId.startsWith('D');

    if (isTyping) {
      if (this.thinkingTs.has(jid)) return; // already showing

      // Try the native assistant typing indicator for all channels/DMs.
      // Requires assistant:write scope + "Agents & AI Apps" feature enabled in the Slack app.
      // Falls back to emoji reaction if unavailable.
      if (threadTs && this.assistantStatusAvailable.get(channelId) !== false) {
        try {
          await (
            this.app.client as unknown as {
              apiCall: (
                method: string,
                args: Record<string, unknown>,
              ) => Promise<void>;
            }
          ).apiCall('assistant.threads.setStatus', {
            channel_id: channelId,
            thread_ts: threadTs,
            status: 'is typing...',
          });
          this.thinkingTs.set(jid, `assistant:${threadTs}`);
          this.assistantStatusAvailable.set(channelId, true);
          return;
        } catch (err) {
          this.assistantStatusAvailable.set(channelId, false);
          logger.info(
            { jid, err },
            'assistant.threads.setStatus unavailable, falling back to reaction',
          );
        }
      }

      // Fallback: add a thinking emoji reaction to the user's message.
      // Visible in the channel without needing the thread open.
      // Requires reactions:write scope.
      const userMsgTs = this.lastUserMessageTs.get(jid);
      if (userMsgTs) {
        try {
          await this.app.client.reactions.add({
            channel: channelId,
            timestamp: userMsgTs,
            name: THINKING_REACTION,
          });
          this.thinkingTs.set(jid, `reaction:${channelId}:${userMsgTs}`);
        } catch (err) {
          logger.warn({ jid, err }, 'Failed to add thinking reaction');
        }
      }
    } else {
      const ts = this.thinkingTs.get(jid);
      if (!ts) return;
      this.thinkingTs.delete(jid);

      if (ts.startsWith('assistant:')) {
        // Clear the native assistant typing indicator
        const indicatorThreadTs = ts.slice('assistant:'.length);
        try {
          await (
            this.app.client as unknown as {
              apiCall: (
                method: string,
                args: Record<string, unknown>,
              ) => Promise<void>;
            }
          ).apiCall('assistant.threads.setStatus', {
            channel_id: channelId,
            thread_ts: indicatorThreadTs,
            status: '',
          });
        } catch (err) {
          logger.warn(
            { jid, err },
            'Failed to clear assistant typing indicator',
          );
        }
      } else if (ts.startsWith('reaction:')) {
        // Remove the thinking emoji reaction
        const parts = ts.split(':');
        const rxChannel = parts[1];
        const rxTs = parts[2];
        try {
          await this.app.client.reactions.remove({
            channel: rxChannel,
            timestamp: rxTs,
            name: THINKING_REACTION,
          });
        } catch (err) {
          logger.warn({ jid, err }, 'Failed to remove thinking reaction');
        }
      }
    }
  }

  /** Read a one-line status string the agent writes to its IPC dir, if present. */
  private readAgentStatus(jid: string): string | null {
    try {
      // Map jid → group folder via registered groups
      const groups = this.opts.registeredGroups();
      const group = groups[jid];
      if (!group) return null;
      const statusFile = path.join(DATA_DIR, 'ipc', group.folder, 'status.txt');
      if (!fs.existsSync(statusFile)) return null;
      const text = fs.readFileSync(statusFile, 'utf-8').trim();
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Sync channel metadata from Slack.
   * Fetches channels the bot is a member of and stores their names in the DB.
   */
  async syncChannelMetadata(): Promise<void> {
    try {
      logger.info('Syncing channel metadata from Slack...');
      let cursor: string | undefined;
      let count = 0;

      do {
        const result = await this.app.client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          cursor,
        });

        for (const ch of result.channels || []) {
          if (ch.id && ch.name && ch.is_member) {
            updateChatName(`slack:${ch.id}`, ch.name);
            count++;
          }
        }

        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);

      logger.info({ count }, 'Slack channel metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync Slack channel metadata');
    }
  }

  private async resolveUserName(userId: string): Promise<string | undefined> {
    if (!userId) return undefined;

    const cached = this.userNameCache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.app.client.users.info({ user: userId });
      const name = result.user?.real_name || result.user?.name;
      if (name) this.userNameCache.set(userId, name);
      return name;
    } catch (err) {
      logger.debug({ userId, err }, 'Failed to resolve Slack user name');
      return undefined;
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing Slack outgoing queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue.shift()!;
        const channelId = item.jid.replace(/^slack:/, '');
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: item.text,
        });
        logger.info(
          { jid: item.jid, length: item.text.length },
          'Queued Slack message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }
}

registerChannel('slack', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
  if (!envVars.SLACK_BOT_TOKEN || !envVars.SLACK_APP_TOKEN) {
    logger.warn('Slack: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set');
    return null;
  }
  return new SlackChannel(opts);
});
