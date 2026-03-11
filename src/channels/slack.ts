import { App, LogLevel } from '@slack/bolt';
import type { GenericMessageEvent, BotMessageEvent } from '@slack/types';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, TRIGGER_PATTERN } from '../config.js';
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

// Fallback status messages used when assistant.threads.setStatus is unavailable.
// Rotated every STATUS_ROTATE_INTERVAL ms while the container is running.
const STATUS_ROTATE_INTERVAL = 4000;
const THINKING_STATUSES = [
  `_${ASSISTANT_NAME} is thinking..._`,
  `_${ASSISTANT_NAME} is working on it..._`,
  `_just a moment..._`,
];

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
  private connected = false;
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private userNameCache = new Map<string, string>();

  private opts: SlackChannelOpts;

  // The thread_ts to reply into for each jid.
  // Set when a non-bot message arrives; cleared when the thread goes idle.
  private activeThreadTs = new Map<string, string>();

  // Whether the assistant.threads.setStatus API is available (detected at runtime).
  // undefined = not yet tested, true = works, false = not available (fall back to post/delete).
  private assistantStatusAvailable: boolean | undefined = undefined;

  // Thinking indicator state.
  // When using assistant API: stores 'assistant:<thread_ts>' so setTyping(false) knows to clear it.
  // When using post/delete fallback: stores the ts of the posted "thinking" message.
  private thinkingTs = new Map<string, string>();
  private thinkingTimers = new Map<string, ReturnType<typeof setInterval>>();

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
  }

  private setupEventHandlers(): void {
    // Use app.event('message') instead of app.message() to capture all
    // message subtypes including bot_message (needed to track our own output)
    this.app.event('message', async ({ event }) => {
      // Bolt's event type is the full MessageEvent union (17+ subtypes).
      // We handle: regular messages (no subtype), bot_message, slack_audio, and file_share.
      // Voice notes from the Slack mobile app arrive as file_share (with files[].subtype = 'slack_audio').
      const subtype = (event as { subtype?: string }).subtype;
      logger.info({ subtype, channel: (event as { channel?: string }).channel, hasFiles: !!(event as { files?: unknown[] }).files?.length }, 'Slack message event received');
      const ALLOWED_SUBTYPES = new Set(['bot_message', 'slack_audio', 'file_share']);
      if (subtype && !ALLOWED_SUBTYPES.has(subtype)) return;

      // After filtering, event is either GenericMessageEvent or BotMessageEvent
      const msg = event as HandledMessageEvent;

      // Check for attached files (e.g. voice notes, images)
      const files = (event as { files?: Array<{
        url_private?: string;
        mimetype?: string;
        name?: string;
        subtype?: string;
        title?: string;
      }> }).files;

      // Require text OR attached files — drop empty messages
      if (!msg.text && (!files || files.length === 0)) return;

      const jid = `slack:${msg.channel}`;
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      const isGroup = msg.channel_type !== 'im';

      // Always report metadata for group discovery
      this.opts.onChatMetadata(jid, timestamp, undefined, 'slack', isGroup);

      // Only deliver full messages for registered groups
      const groups = this.opts.registeredGroups();
      if (!groups[jid]) return;

      const isBotMessage = !!msg.bot_id || msg.user === this.botUserId;

      // Track the thread to reply into: use the existing thread or start one
      // from this message's ts. Updated on every non-bot inbound message so
      // follow-up messages in the same thread continue in that thread.
      if (!isBotMessage) {
        const threadTs = (msg as { thread_ts?: string }).thread_ts ?? msg.ts;
        this.activeThreadTs.set(jid, threadTs);
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
      let content = msg.text ?? '';
      if (this.botUserId && !isBotMessage) {
        const mentionPattern = `<@${this.botUserId}>`;
        if (
          content.includes(mentionPattern) &&
          !TRIGGER_PATTERN.test(content)
        ) {
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
          const isImage = file.url_private && file.mimetype?.startsWith('image/');
          if (isAudio) {
            const transcript = await this.transcribeSlackAudio(file.url_private!);
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
      const ext = fileUrl.includes('.') ? fileUrl.split('.').pop()!.split('?')[0] : 'mp4';

      // Send to OpenAI Whisper
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      formData.append('file', blob, `voice.${ext}`);
      formData.append('model', 'whisper-1');

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        throw new Error(`Whisper API error ${whisperRes.status}: ${errText}`);
      }

      const result = await whisperRes.json() as { text: string };
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

      logger.info({ fileUrl, destPath }, 'Slack image saved for agent analysis');
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
      logger.info({ botUserId: this.botUserId }, 'Connected to Slack');
    } catch (err) {
      logger.warn({ err }, 'Connected to Slack but failed to get bot user ID');
    }

    this.connected = true;

    // Flush any messages queued before connection
    await this.flushOutgoingQueue();

    // Sync channel names on startup
    await this.syncChannelMetadata();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
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
      const threadTs = this.activeThreadTs.get(jid);
      // Slack limits messages to ~4000 characters; split if needed
      if (text.length <= MAX_MESSAGE_LENGTH) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text,
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
      } else {
        for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: text.slice(i, i + MAX_MESSAGE_LENGTH),
            ...(threadTs ? { thread_ts: threadTs } : {}),
          });
        }
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

  async sendMedia(jid: string, filePath: string, filename?: string): Promise<void> {
    const channelId = jid.replace(/^slack:/, '');
    const threadTs = this.activeThreadTs.get(jid);
    const fname = filename || path.basename(filePath);

    try {
      const fileBuffer = fs.readFileSync(filePath);
      await this.app.client.files.uploadV2({
        channel_id: channelId,
        filename: fname,
        file: fileBuffer,
        // thread_ts must be string if present; cast via record to satisfy the union type
        ...(threadTs ? ({ thread_ts: threadTs } as Record<string, unknown>) : {}),
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
    const threadTs = this.activeThreadTs.get(jid);

    if (isTyping) {
      if (this.thinkingTs.has(jid)) return; // already showing

      // Try the native Slack assistant typing indicator first.
      // Requires assistant:write scope + app configured as AI app.
      if (threadTs && this.assistantStatusAvailable !== false) {
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
          this.assistantStatusAvailable = true;
          return;
        } catch {
          // API not available — fall through to post/rotate/delete fallback
          this.assistantStatusAvailable = false;
          logger.debug(
            { jid },
            'assistant.threads.setStatus unavailable, using fallback typing indicator',
          );
        }
      }

      // Fallback: post a "thinking..." message and rotate its text.
      try {
        const result = await this.app.client.chat.postMessage({
          channel: channelId,
          text: THINKING_STATUSES[0],
          ...(threadTs ? { thread_ts: threadTs } : {}),
        });
        if (!result.ts) return;
        const ts = result.ts as string;
        this.thinkingTs.set(jid, ts);

        let idx = 0;
        const timer = setInterval(async () => {
          idx = (idx + 1) % THINKING_STATUSES.length;
          const statusText =
            this.readAgentStatus(jid) ?? THINKING_STATUSES[idx];
          try {
            await this.app.client.chat.update({
              channel: channelId,
              ts,
              text: statusText,
            });
          } catch {
            // message may have been deleted already; stop rotating
            clearInterval(timer);
            this.thinkingTimers.delete(jid);
          }
        }, STATUS_ROTATE_INTERVAL);
        this.thinkingTimers.set(jid, timer);
      } catch (err) {
        logger.warn({ jid, err }, 'Failed to post thinking indicator');
      }
    } else {
      // Stop rotation timer (if any)
      const timer = this.thinkingTimers.get(jid);
      if (timer) {
        clearInterval(timer);
        this.thinkingTimers.delete(jid);
      }

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
      } else {
        // Delete the fallback "thinking..." message
        try {
          await this.app.client.chat.delete({ channel: channelId, ts });
        } catch (err) {
          logger.warn({ jid, err }, 'Failed to delete thinking indicator');
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
