/**
 * Slack Thread Sync — keeps the local messages DB in sync with Slack.
 *
 * Three reconciliation modes:
 * 1. Startup — reconcile all active thread groups on boot
 * 2. Periodic — light sync every SYNC_INTERVAL_MS for active groups
 * 3. Gap detection — on each inbound message, check for missing messages
 *
 * Also handles:
 * - Thread backfill when a new thread group is created
 * - Channel context fetch for new threads (recent channel messages)
 * - Message edit/delete propagation
 *
 * Runs entirely in the host process — no agent involvement.
 */

import type { WebClient } from '@slack/web-api';

import { ASSISTANT_NAME } from '../config.js';
import {
  getLatestStoredTimestamp,
  messageExists,
  storeMessageDirect,
} from '../db.js';
import { logger } from '../logger.js';
import type { RegisteredGroup } from '../types.js';

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT_DELAY_MS = 1500; // Space out API calls

function slackTsToIso(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SlackThreadSync {
  private periodicTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private client: WebClient,
    private botUserId: string | undefined,
  ) {}

  /**
   * Backfill a Slack thread into the DB.
   * Called when a new thread group is created.
   * Returns the number of messages inserted.
   */
  async backfillThread(
    channelId: string,
    threadTs: string,
    threadJid: string,
  ): Promise<number> {
    let inserted = 0;
    try {
      let cursor: string | undefined;
      do {
        const result = await this.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          limit: 200,
          cursor,
        });

        for (const msg of result.messages || []) {
          if (!msg.ts || !msg.text) continue;
          if (messageExists(msg.ts, threadJid)) continue;

          const isBotMessage =
            (msg.bot_id != null && msg.user === this.botUserId) ||
            msg.user === this.botUserId;

          storeMessageDirect({
            id: msg.ts,
            chat_jid: threadJid,
            sender: msg.user || msg.bot_id || 'unknown',
            sender_name: isBotMessage ? ASSISTANT_NAME : msg.user || 'unknown',
            content: msg.text,
            timestamp: slackTsToIso(msg.ts),
            is_from_me: false,
            is_bot_message: isBotMessage,
          });
          inserted++;
        }

        cursor = result.response_metadata?.next_cursor || undefined;
        if (cursor) await sleep(RATE_LIMIT_DELAY_MS);
      } while (cursor);

      if (inserted > 0) {
        logger.info(
          { threadJid, channelId, threadTs, inserted },
          'Thread backfill complete',
        );
      }
    } catch (err) {
      logger.warn(
        { threadJid, channelId, threadTs, error: err },
        'Thread backfill failed',
      );
    }
    return inserted;
  }

  /**
   * Detect and fill gaps for a JID.
   * Compares the latest stored timestamp against the inbound message.
   * If there's a gap, fetches missing messages from Slack.
   */
  async fillGaps(
    channelId: string,
    jid: string,
    threadTs?: string,
  ): Promise<number> {
    const latestStored = getLatestStoredTimestamp(jid);
    if (!latestStored) return 0; // No history yet, nothing to gap-fill

    try {
      const oldestNeeded = (new Date(latestStored).getTime() / 1000).toFixed(6);

      let messages;
      if (threadTs) {
        const result = await this.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          oldest: oldestNeeded,
          limit: 100,
        });
        messages = result.messages || [];
      } else {
        const result = await this.client.conversations.history({
          channel: channelId,
          oldest: oldestNeeded,
          limit: 100,
        });
        messages = result.messages || [];
      }

      let inserted = 0;
      for (const msg of messages) {
        if (!msg.ts || !msg.text) continue;
        if (messageExists(msg.ts, jid)) continue;

        const isBotMessage =
          (msg.bot_id != null && msg.user === this.botUserId) ||
          msg.user === this.botUserId;

        storeMessageDirect({
          id: msg.ts,
          chat_jid: jid,
          sender: msg.user || msg.bot_id || 'unknown',
          sender_name: isBotMessage ? ASSISTANT_NAME : msg.user || 'unknown',
          content: msg.text,
          timestamp: slackTsToIso(msg.ts),
          is_from_me: false,
          is_bot_message: isBotMessage,
        });
        inserted++;
      }

      if (inserted > 0) {
        logger.info(
          { jid, channelId, inserted },
          'Gap fill: inserted missing messages',
        );
      }
      return inserted;
    } catch (err) {
      logger.warn({ jid, channelId, error: err }, 'Gap fill failed');
      return 0;
    }
  }

  /**
   * Reconcile all active Slack groups on startup.
   * Iterates thread groups and runs gap detection for each.
   */
  async startupReconciliation(
    groups: Record<string, RegisteredGroup>,
  ): Promise<void> {
    const slackGroups = Object.entries(groups).filter(([jid]) =>
      jid.startsWith('slack:'),
    );

    if (slackGroups.length === 0) return;

    logger.info(
      { groupCount: slackGroups.length },
      'Slack sync: starting reconciliation',
    );

    for (const [jid, group] of slackGroups) {
      const parts = jid.replace(/^slack:/, '').split(':t:');
      const channelId = parts[0];
      const threadTs = parts[1]?.replace('-', '.');

      if (group.isThreadGroup && threadTs) {
        await this.fillGaps(channelId, jid, threadTs);
      } else {
        // Channel/DM — light gap fill
        await this.fillGaps(channelId, jid);
      }
      await sleep(RATE_LIMIT_DELAY_MS);
    }

    logger.info('Slack sync: startup reconciliation complete');
  }

  /**
   * Start periodic background sync.
   */
  startPeriodicSync(getGroups: () => Record<string, RegisteredGroup>): void {
    if (this.periodicTimer) return;

    this.periodicTimer = setInterval(async () => {
      try {
        await this.startupReconciliation(getGroups());
      } catch (err) {
        logger.warn({ error: err }, 'Periodic Slack sync failed');
      }
    }, SYNC_INTERVAL_MS);

    logger.info(
      { intervalMs: SYNC_INTERVAL_MS },
      'Slack sync: periodic sync started',
    );
  }

  stop(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }
}
