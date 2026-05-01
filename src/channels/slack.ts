import { App, LogLevel } from '@slack/bolt';
import type { GenericMessageEvent, BotMessageEvent } from '@slack/types';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, TRIGGER_PATTERN } from '../config.js';

// Persist bot-participated thread IDs so restarts don't break auto-trigger.
// Keyed by jid → array of { ts, savedAt }. Never pruned — threads stay active indefinitely
// so the bot auto-triggers on replies even weeks/months later.
const BOT_THREADS_PATH = path.join(DATA_DIR, 'bot-threads.json');
import { updateChatName, updateMessageContent, deleteMessage } from '../db.js';
import { SlackThreadSync } from './slack-sync.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import { downloadSlackFile, downloadSlackImage, transcribeSlackAudio } from './slack-media.js';
import { SlackTypingIndicator } from './slack-typing.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

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
  // Called when a thread reply arrives for a registered channel but no thread group exists yet.
  // The host creates the group dynamically so the message can be routed.
  onThreadGroup?: (
    threadJid: string,
    parentJid: string,
    threadTs: string,
  ) => void;
}

/** Cached user name with TTL. Borrowed from Chat SDK's 8-day cache pattern. */
interface CachedName {
  name: string;
  cachedAt: number;
}
const USER_CACHE_TTL_MS = 8 * 24 * 60 * 60 * 1000; // 8 days

export class SlackChannel implements Channel {
  name = 'slack';

  private app: App;
  private botUserId: string | undefined;
  private botId: string | undefined; // bot_id (B-prefixed) — distinct from botUserId (U-prefixed)
  private connected = false;
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private userNameCache = new Map<string, CachedName>();

  private opts: SlackChannelOpts;
  private typingIndicator: SlackTypingIndicator;
  private threadSync: SlackThreadSync | null = null;

  // The thread_ts to reply into for each jid, with the time it was set.
  // Expires after THREAD_CONTEXT_TTL_MS so IPC/scheduled messages don't
  // piggyback on a stale thread from an earlier conversation.
  private activeThreadTs = new Map<string, { ts: string; setAt: number }>();
  private static readonly THREAD_CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes

  /** Get the active thread_ts for a jid, or undefined if expired. */
  private getActiveThread(jid: string): string | undefined {
    const entry = this.activeThreadTs.get(jid);
    if (!entry) return undefined;
    // DM channels (D-prefixed) keep thread context indefinitely — there's only
    // one conversation so the thread should always be reused.
    const channelId = jid.replace(/^slack:/, '');
    const isDm = channelId.startsWith('D');
    if (
      !isDm &&
      Date.now() - entry.setAt > SlackChannel.THREAD_CONTEXT_TTL_MS
    ) {
      this.activeThreadTs.delete(jid);
      return undefined;
    }
    return entry.ts;
  }

  // The ts of the latest inbound user message per jid.
  // Used to add/remove a thinking emoji reaction while processing.
  private lastUserMessageTs = new Map<string, string>();

  // Threads where the bot has previously replied, keyed by jid → Set<thread_ts>.
  // Used to auto-trigger responses when the user replies to an existing bot thread
  // without @mentioning the bot.
  private botParticipatedThreads = new Map<string, Set<string>>();

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

    this.typingIndicator = new SlackTypingIndicator(this.app);

    this.setupEventHandlers();
    this.loadBotThreads();
  }

  // ── Bot-thread persistence ──────────────────────────────────────────

  /** Load persisted bot-thread participation from disk. */
  private loadBotThreads(): void {
    try {
      const raw = JSON.parse(
        fs.readFileSync(BOT_THREADS_PATH, 'utf8'),
      ) as Record<string, Array<{ ts: string; savedAt: number }>>;
      for (const [jid, entries] of Object.entries(raw)) {
        if (entries.length > 0) {
          this.botParticipatedThreads.set(
            jid,
            new Set(entries.map((e) => e.ts)),
          );
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

  // ── Event handling ──────────────────────────────────────────────────

  private setupEventHandlers(): void {
    // Use app.event('message') instead of app.message() to capture all
    // message subtypes including bot_message (needed to track our own output)
    this.app.event('message', async ({ event }) => {
      const subtype = (event as { subtype?: string }).subtype;

      // Handle message edits — update content in DB to stay in sync with Slack
      if (subtype === 'message_changed') {
        const changed = event as {
          channel: string;
          message?: { ts?: string; text?: string };
        };
        if (changed.message?.ts && changed.message?.text) {
          const channelJid = `slack:${changed.channel}`;
          updateMessageContent(
            changed.message.ts,
            channelJid,
            changed.message.text,
          );
          logger.debug(
            { channel: changed.channel, ts: changed.message.ts },
            'Slack message edited, DB updated',
          );
        }
        return;
      }

      // Handle message deletions — remove from DB
      if (subtype === 'message_deleted') {
        const deleted = event as {
          channel: string;
          previous_message?: { ts?: string };
        };
        if (deleted.previous_message?.ts) {
          const channelJid = `slack:${deleted.channel}`;
          deleteMessage(deleted.previous_message.ts, channelJid);
          logger.debug(
            { channel: deleted.channel, ts: deleted.previous_message.ts },
            'Slack message deleted, DB updated',
          );
        }
        return;
      }

      // Bolt's event type is the full MessageEvent union (17+ subtypes).
      // We handle: regular messages (no subtype), bot_message, slack_audio, and file_share.
      // Voice notes from the Slack mobile app arrive as file_share (with files[].subtype = 'slack_audio').
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
        attachments?: Array<{
          text?: string;
          fallback?: string;
          pretext?: string;
        }>;
        blocks?: Array<{
          type: string;
          text?: { text?: string };
          elements?: Array<{
            type: string;
            text?: string;
            elements?: Array<{ text?: string }>;
          }>;
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

      const channelJid = `slack:${msg.channel}`;
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      const isGroup = msg.channel_type !== 'im';

      // Always report metadata for group discovery (channel-level)
      this.opts.onChatMetadata(
        channelJid,
        timestamp,
        undefined,
        'slack',
        isGroup,
      );

      // Determine routing: thread replies go to thread-specific JIDs,
      // channel-level messages go to the channel JID.
      const messageThreadTs = (msg as { thread_ts?: string }).thread_ts;
      const isThreadReply = !!(messageThreadTs && messageThreadTs !== msg.ts);

      const groups = this.opts.registeredGroups();
      const channelGroup = groups[channelJid];

      // Build the effective JID for this message
      let jid: string;
      const isChannel = msg.channel_type !== 'im';
      if (isThreadReply && channelGroup && isChannel) {
        // Thread reply in a registered channel → route to thread group
        // DM threads stay in the DM group (already 1-on-1, no need for isolation)
        const threadJid = `slack:${msg.channel}:t:${messageThreadTs}`;
        jid = threadJid;
        // Auto-create thread group if it doesn't exist (via callback)
        if (!groups[jid]) {
          this.opts.onThreadGroup?.(threadJid, channelJid, messageThreadTs);
          // Re-check after creation
          const updatedGroups = this.opts.registeredGroups();
          if (!updatedGroups[jid]) return; // Creation failed, skip

          // Backfill the full thread from Slack API so the agent has complete history
          this.threadSync
            ?.backfillThread(msg.channel, messageThreadTs, threadJid)
            .catch((err) =>
              logger.warn({ threadJid, err }, 'Thread backfill failed'),
            );
        }
      } else {
        jid = channelJid;
        if (!groups[jid]) return;
      }

      // Only treat messages from OUR bot as bot messages.
      // Other bots (snyk-bot, etc.) should appear as regular messages
      // so the agent can see and respond to them.
      const isBotMessage =
        (msg.bot_id != null && msg.bot_id === this.botId) ||
        msg.user === this.botUserId;

      // Track the thread to reply into. For thread groups, the thread_ts is
      // embedded in the JID so activeThreadTs is not needed. For channel-level
      // messages and DMs, track the thread so replies and typing indicators work.
      if (!isBotMessage) {
        // DM thread replies still route to the channel JID (no thread groups for DMs),
        // so we must always update activeThreadTs for DMs. For channels, only set it
        // on top-level messages (thread groups handle the rest).
        const isDmChannel = msg.channel_type === 'im';
        if (!isThreadReply || isDmChannel) {
          const threadTs = messageThreadTs ?? msg.ts;
          this.activeThreadTs.set(jid, { ts: threadTs, setAt: Date.now() });
        }
        this.lastUserMessageTs.set(jid, msg.ts);
      }

      // Track threads where the bot has replied so we can auto-trigger
      // responses to thread replies without an @mention.
      // Use the channel JID for this map (thread groups handle auto-trigger via requiresTrigger: false).
      if (isBotMessage) {
        const botThreadTs = (msg as { thread_ts?: string }).thread_ts;
        if (botThreadTs) {
          if (!this.botParticipatedThreads.has(channelJid)) {
            this.botParticipatedThreads.set(channelJid, new Set());
          }
          this.botParticipatedThreads.get(channelJid)!.add(botThreadTs);
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
      // For thread groups, always prepend trigger (requiresTrigger is false, so the
      // main loop processes all messages, but the trigger prefix helps the agent
      // understand it was addressed). For channel messages, auto-trigger on @mention
      // or when the user replies to a thread where the bot has already replied.
      let content = msg.text || fallbackText || '';
      if (!isBotMessage && !TRIGGER_PATTERN.test(content)) {
        const isMentioned =
          this.botUserId && content.includes(`<@${this.botUserId}>`);
        const isInThreadGroup = isThreadReply && jid.includes(':t:');
        const isThreadReplyWithBot =
          !isInThreadGroup &&
          messageThreadTs &&
          this.botParticipatedThreads.get(channelJid)?.has(messageThreadTs);

        if (isMentioned || isInThreadGroup || isThreadReplyWithBot) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      // Transcribe audio/voice files and download images so the agent can analyze them.
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
            const transcript = await transcribeSlackAudio(file.url_private!);
            if (transcript) {
              content = content ? `${transcript}\n${content}` : transcript;
            }
          } else if (isImage && groupFolder) {
            const imagePath = await downloadSlackImage(
              file.url_private!,
              file.name || `image-${Date.now()}.jpg`,
              groupFolder,
            );
            if (imagePath) {
              const imageNote = `[Image attached: ${imagePath} — use the Read tool to view and analyze it]`;
              content = content ? `${content}\n${imageNote}` : imageNote;
            }
          } else if (file.url_private && groupFolder) {
            const filePath = await downloadSlackFile(
              file.url_private,
              file.name || `file-${Date.now()}`,
              groupFolder,
            );
            if (filePath) {
              const isPdf = file.mimetype === 'application/pdf' || file.name?.endsWith('.pdf');
              const fileNote = isPdf
                ? `[PDF attached: ${filePath} — run \`pdftotext ${filePath} -\` to extract text, or use the Read tool]`
                : `[File attached: ${filePath} (${file.mimetype || 'unknown type'}) — use the Read tool or bash to read it]`;
              content = content ? `${content}\n${fileNote}` : fileNote;
            }
          }
        }
      }

      // After transcription, drop if still empty (e.g. non-audio file with no text)
      if (!content) return;

      // Gap detection: check if there are missing messages between last stored and this one.
      // Runs in background — doesn't block message delivery.
      if (this.threadSync && !isBotMessage) {
        const threadTs = isThreadReply ? messageThreadTs : undefined;
        this.threadSync
          .fillGaps(msg.channel, jid, threadTs)
          .catch((err) =>
            logger.debug({ jid, err }, 'Gap detection failed (non-critical)'),
          );
      }

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

  // ── Connection lifecycle ────────────────────────────────────────────

  async connect(): Promise<void> {
    await this.app.start();

    // Get bot's own user ID for self-message detection.
    // Resolve this BEFORE setting connected=true so that messages arriving
    // during startup can correctly detect bot-sent messages.
    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id as string;
      this.botId = auth.bot_id as string | undefined;
      logger.info(
        { botUserId: this.botUserId, botId: this.botId },
        'Connected to Slack',
      );
    } catch (err) {
      logger.warn({ err }, 'Connected to Slack but failed to get bot user ID');
    }

    this.connected = true;

    // Flush any messages queued before connection
    await this.flushOutgoingQueue();

    // Sync channel names on startup
    await this.syncChannelMetadata();

    // Initialize thread sync: reconcile DB with Slack on startup + periodic sync
    this.threadSync = new SlackThreadSync(this.app.client, this.botUserId);
    this.threadSync
      .startupReconciliation(this.opts.registeredGroups())
      .catch((err) =>
        logger.warn({ err }, 'Slack sync: startup reconciliation failed'),
      );
    this.threadSync.startPeriodicSync(() => this.opts.registeredGroups());
  }

  // ── Outbound messaging ──────────────────────────────────────────────

  /**
   * Extract channelId and optional embedded threadTs from a JID.
   * Thread JIDs: "slack:C0APUHPBE5Q:t:1709234567.123" → { channelId, threadTs }
   * Channel JIDs: "slack:C0APUHPBE5Q" → { channelId }
   */
  private parseJid(jid: string): { channelId: string; threadTs?: string } {
    const match = jid.match(/^slack:([^:]+):t:(.+)$/);
    if (match) return { channelId: match[1], threadTs: match[2] };
    return { channelId: jid.replace(/^slack:/, '') };
  }

  async sendMessage(
    jid: string,
    text: string,
    opts?: { noThread?: boolean },
  ): Promise<void> {
    const { channelId, threadTs: embeddedThreadTs } = this.parseJid(jid);

    if (!this.connected) {
      this.outgoingQueue.push({ jid, text });
      logger.info(
        { jid, queueSize: this.outgoingQueue.length },
        'Slack disconnected, message queued',
      );
      return;
    }

    try {
      // Thread JIDs always reply in their thread; channel JIDs use activeThread
      const threadTs =
        embeddedThreadTs ||
        (opts?.noThread ? undefined : this.getActiveThread(jid));
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
    const { channelId, threadTs: embeddedThreadTs } = this.parseJid(jid);
    const threadTs = embeddedThreadTs || this.getActiveThread(jid);
    const fname = filename || path.basename(filePath);

    try {
      const fileBuffer = fs.readFileSync(filePath);
      await this.app.client.files.uploadV2({
        channel_id: channelId,
        filename: fname,
        file: fileBuffer,
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
    this.threadSync?.stop();
    await this.app.stop();
  }

  // ── Typing indicator (delegates to extracted module) ─────────────────

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    const { threadTs: embeddedThreadTs } = this.parseJid(jid);
    await this.typingIndicator.setTyping(
      jid,
      isTyping,
      embeddedThreadTs || this.getActiveThread(jid),
      this.lastUserMessageTs.get(jid),
    );
  }

  // ── Agent status (read from IPC status file) ────────────────────────

  /** Read a one-line status string the agent writes to its IPC dir, if present. */
  readAgentStatus(jid: string): string | null {
    try {
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

  // ── Channel metadata ────────────────────────────────────────────────

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
    if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL_MS) {
      return cached.name;
    }

    try {
      const result = await this.app.client.users.info({ user: userId });
      const name = result.user?.real_name || result.user?.name;
      if (name) {
        this.userNameCache.set(userId, { name, cachedAt: Date.now() });
      }
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
        const { channelId, threadTs } = this.parseJid(item.jid);
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: item.text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
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
