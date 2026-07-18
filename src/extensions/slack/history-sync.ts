/**
 * Slack history sync — v2 port of v1 SlackThreadSync.
 *
 * Fetches thread/channel history from the Slack Web API and writes context
 * rows (trigger=0) into session inbound DBs. Also exports JSON snapshots to
 * the agent group folder for MCP search.
 */
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME } from '../../config.js';
import { decodeSlackThreadId } from '../../channels/slack-stream.js';
import { getAgentGroup } from '../../db/agent-groups.js';
import { getMessagingGroup, getMessagingGroupAgents } from '../../db/messaging-groups.js';
import { getActiveSessions } from '../../db/sessions.js';
import { readEnvFile } from '../../env.js';
import { log } from '../../log.js';
import { resolveGroupFolderPath } from '../../group-folder.js';
import { inboundDbPath, openInboundDb, resolveSession, writeSessionMessage } from '../../session-manager.js';
import type { MessagingGroup, MessagingGroupAgent, Session } from '../../types.js';
import type { InboundEvent } from '../../channels/adapter.js';

const SYNC_INTERVAL_MS = 30 * 60 * 1000;
const RATE_LIMIT_DELAY_MS = 1500;
const BACKFILL_LIMIT = 200;
const CHANNEL_CONTEXT_LIMIT = 50;

type SlackMessage = {
  ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  thread_ts?: string;
};

let botUserId: string | undefined;
let periodicTimer: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSlackToken(): string | null {
  const env = readEnvFile(['SLACK_BOT_TOKEN']);
  return env.SLACK_BOT_TOKEN ?? process.env.SLACK_BOT_TOKEN ?? null;
}

async function slackApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T & { ok?: boolean; error?: string }> {
  const token = getSlackToken();
  if (!token) throw new Error('SLACK_BOT_TOKEN not configured');

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    },
    body: params.toString(),
  });
  return (await res.json()) as T & { ok?: boolean; error?: string };
}

async function ensureBotUserId(): Promise<string | undefined> {
  if (botUserId) return botUserId;
  try {
    const result = await slackApi<{ user_id?: string }>('auth.test', {});
    if (result.ok && result.user_id) {
      botUserId = result.user_id;
    }
  } catch (err) {
    log.warn('Slack auth.test failed', { err });
  }
  return botUserId;
}

function slackTsToIso(ts: string): string {
  return new Date(parseFloat(ts) * 1000).toISOString();
}

function historyMessageId(ts: string): string {
  return `slack-sync:${ts}`;
}

function sessionHasMessage(agentGroupId: string, sessionId: string, id: string): boolean {
  const dbPath = inboundDbPath(agentGroupId, sessionId);
  if (!fs.existsSync(dbPath)) return false;
  const db = openInboundDb(agentGroupId, sessionId);
  try {
    const row = db.prepare('SELECT 1 FROM messages_in WHERE id = ? LIMIT 1').get(id);
    return row !== undefined;
  } finally {
    db.close();
  }
}

/** True if this Slack ts already exists as a live or synced inbound row. */
function sessionHasSlackTs(agentGroupId: string, sessionId: string, ts: string): boolean {
  const dbPath = inboundDbPath(agentGroupId, sessionId);
  if (!fs.existsSync(dbPath)) return false;
  const db = openInboundDb(agentGroupId, sessionId);
  try {
    const row = db
      .prepare(
        `SELECT 1 FROM messages_in
         WHERE id = ? OR content LIKE ?
         LIMIT 1`,
      )
      .get(historyMessageId(ts), `%"slackTs":"${ts}"%`);
    return row !== undefined;
  } finally {
    db.close();
  }
}

function buildHistoryContent(msg: SlackMessage, isBot: boolean, channelIsGroup: boolean): string {
  return JSON.stringify({
    text: msg.text ?? '',
    sender: isBot ? ASSISTANT_NAME : (msg.user ?? 'unknown'),
    senderId: msg.user ?? msg.bot_id ?? 'unknown',
    isGroup: channelIsGroup,
    syncedFromSlack: true,
    slackTs: msg.ts,
  });
}

async function insertHistoryMessage(
  session: Session,
  mg: MessagingGroup,
  platformId: string,
  threadId: string | null,
  msg: SlackMessage,
  isBot: boolean,
): Promise<boolean> {
  if (!msg.ts || !msg.text?.trim()) return false;
  const id = historyMessageId(msg.ts);
  if (sessionHasMessage(session.agent_group_id, session.id, id)) return false;
  // Pre-route sync can land before deliverToAgent writes the live row;
  // also skip when a live Chat SDK row already carries this slackTs.
  if (sessionHasSlackTs(session.agent_group_id, session.id, msg.ts)) return false;

  writeSessionMessage(session.agent_group_id, session.id, {
    id,
    kind: 'chat-sdk',
    timestamp: slackTsToIso(msg.ts),
    platformId,
    channelType: 'slack',
    threadId,
    content: buildHistoryContent(msg, isBot, mg.is_group !== 0),
    trigger: 0,
  });
  return true;
}

function effectiveSessionMode(
  agent: MessagingGroupAgent,
  mg: MessagingGroup,
): 'shared' | 'per-thread' | 'agent-shared' {
  let mode = agent.session_mode;
  if (mode !== 'agent-shared' && mg.is_group !== 0) {
    mode = 'per-thread';
  }
  return mode;
}

async function fetchThreadMessages(channelId: string, threadTs: string): Promise<SlackMessage[]> {
  const messages: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const result = await slackApi<{ messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } }>(
      'conversations.replies',
      { channel: channelId, ts: threadTs, limit: BACKFILL_LIMIT, cursor },
    );
    if (!result.ok) {
      throw new Error(result.error ?? 'conversations.replies failed');
    }
    messages.push(...(result.messages ?? []));
    cursor = result.response_metadata?.next_cursor || undefined;
    if (cursor) await sleep(RATE_LIMIT_DELAY_MS);
  } while (cursor);
  return messages;
}

async function fetchChannelMessages(channelId: string, oldest?: string): Promise<SlackMessage[]> {
  const body: Record<string, unknown> = { channel: channelId, limit: CHANNEL_CONTEXT_LIMIT };
  if (oldest) body.oldest = oldest;
  const result = await slackApi<{ messages?: SlackMessage[] }>('conversations.history', body);
  if (!result.ok) {
    throw new Error(result.error ?? 'conversations.history failed');
  }
  return result.messages ?? [];
}

async function backfillThreadIntoSession(
  session: Session,
  mg: MessagingGroup,
  platformId: string,
  threadId: string,
  channelId: string,
  threadTs: string,
): Promise<number> {
  await ensureBotUserId();
  let inserted = 0;
  try {
    const messages = await fetchThreadMessages(channelId, threadTs);
    for (const msg of messages) {
      const isBot = (msg.bot_id != null && msg.user === botUserId) || msg.user === botUserId;
      if (await insertHistoryMessage(session, mg, platformId, threadId, msg, isBot)) {
        inserted++;
      }
    }
    if (inserted > 0) {
      log.info('Slack thread backfill', { sessionId: session.id, threadId, inserted });
    }
  } catch (err) {
    log.warn('Slack thread backfill failed', { sessionId: session.id, threadId, err });
  }
  return inserted;
}

async function fillGapsForSession(
  session: Session,
  mg: MessagingGroup,
  platformId: string,
  threadId: string | null,
  channelId: string,
  threadTs?: string,
): Promise<number> {
  await ensureBotUserId();
  const db = openInboundDb(session.agent_group_id, session.id);
  let oldestNeeded: string | undefined;
  try {
    const row = db
      .prepare(
        `SELECT content FROM messages_in
         WHERE id LIKE 'slack-sync:%'
         ORDER BY timestamp DESC LIMIT 1`,
      )
      .get() as { content: string } | undefined;
    if (row) {
      try {
        const parsed = JSON.parse(row.content) as { slackTs?: string };
        if (parsed.slackTs) oldestNeeded = parsed.slackTs;
      } catch {
        /* ignore */
      }
    }
  } finally {
    db.close();
  }

  if (!oldestNeeded) return 0;

  let inserted = 0;
  try {
    const messages = threadTs
      ? await slackApi<{ messages?: SlackMessage[] }>('conversations.replies', {
          channel: channelId,
          ts: threadTs,
          oldest: oldestNeeded,
          limit: 100,
        }).then((r) => {
          if (!r.ok) throw new Error(r.error);
          return r.messages ?? [];
        })
      : await fetchChannelMessages(channelId, oldestNeeded);

    for (const msg of messages) {
      const isBot = (msg.bot_id != null && msg.user === botUserId) || msg.user === botUserId;
      if (await insertHistoryMessage(session, mg, platformId, threadId, msg, isBot)) {
        inserted++;
      }
    }
    if (inserted > 0) {
      log.info('Slack gap fill', { sessionId: session.id, threadId, inserted });
    }
  } catch (err) {
    log.warn('Slack gap fill failed', { sessionId: session.id, threadId, err });
  }
  return inserted;
}

export interface HistoryExportEntry {
  ts: string;
  timestamp: string;
  sender: string;
  text: string;
  threadId: string | null;
  syncedFromSlack: true;
}

function readSessionHistoryExport(session: Session): HistoryExportEntry[] {
  const db = openInboundDb(session.agent_group_id, session.id);
  try {
    const rows = db
      .prepare(
        `SELECT content, thread_id, timestamp FROM messages_in
         WHERE kind IN ('chat-sdk', 'chat')
         ORDER BY timestamp ASC`,
      )
      .all() as Array<{ content: string; thread_id: string | null; timestamp: string }>;

    const out: HistoryExportEntry[] = [];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.content) as { text?: string; sender?: string; slackTs?: string };
        const text = parsed.text ?? '';
        if (!text.trim()) continue;
        out.push({
          ts: parsed.slackTs ?? row.timestamp,
          timestamp: row.timestamp,
          sender: parsed.sender ?? 'unknown',
          text,
          threadId: row.thread_id,
          syncedFromSlack: true,
        });
      } catch {
        /* skip malformed */
      }
    }
    return out;
  } finally {
    db.close();
  }
}

export function exportSessionHistoryFiles(session: Session): void {
  const ag = getAgentGroup(session.agent_group_id);
  if (!ag) return;

  const entries = readSessionHistoryExport(session);
  if (entries.length === 0) return;

  const groupDir = resolveGroupFolderPath(ag.folder);
  const threadFile = path.join(groupDir, 'slack_history.json');
  fs.writeFileSync(threadFile, JSON.stringify(entries, null, 2));

  if (session.messaging_group_id) {
    const mg = getMessagingGroup(session.messaging_group_id);
    if (mg && mg.is_group !== 0 && session.thread_id) {
      void exportCrossChannelHistory(ag.folder, mg.platform_id.replace(/^slack:/, ''), entries);
    }
  }
}

async function exportCrossChannelHistory(
  groupFolder: string,
  channelId: string,
  currentSessionEntries: HistoryExportEntry[],
): Promise<void> {
  try {
    const channelMsgs = await fetchChannelMessages(channelId);
    const crossEntries: HistoryExportEntry[] = [...currentSessionEntries];
    for (const msg of channelMsgs) {
      if (!msg.ts || !msg.text?.trim()) continue;
      crossEntries.push({
        ts: msg.ts,
        timestamp: slackTsToIso(msg.ts),
        sender: msg.user ?? 'unknown',
        text: msg.text,
        threadId: msg.thread_ts ? `slack:${channelId}:${msg.thread_ts}` : null,
        syncedFromSlack: true,
      });
    }
    crossEntries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const groupDir = resolveGroupFolderPath(groupFolder);
    fs.writeFileSync(path.join(groupDir, 'slack_channel_history.json'), JSON.stringify(crossEntries, null, 2));
  } catch (err) {
    log.warn('Cross-channel history export failed', { channelId, err });
  }
}

export async function syncSessionFromSlack(session: Session): Promise<void> {
  if (!session.messaging_group_id) return;
  const mg = getMessagingGroup(session.messaging_group_id);
  if (!mg || mg.channel_type !== 'slack') return;

  const platformId = mg.platform_id.startsWith('slack:') ? mg.platform_id : `slack:${mg.platform_id}`;
  const threadId = session.thread_id;
  const decoded = threadId ? decodeSlackThreadId(threadId) : null;
  const channelId = decoded?.channel ?? platformId.replace(/^slack:/, '');

  if (threadId && decoded?.threadTs) {
    await backfillThreadIntoSession(session, mg, platformId, threadId, channelId, decoded.threadTs);
    await fillGapsForSession(session, mg, platformId, threadId, channelId, decoded.threadTs);
  } else {
    await fillGapsForSession(session, mg, platformId, null, channelId);
  }

  exportSessionHistoryFiles(session);
}

export async function syncSlackAgentsForMessagingGroup(
  mg: MessagingGroup,
  platformId: string,
  threadId: string | null,
): Promise<void> {
  if (mg.channel_type !== 'slack') return;
  const agents = getMessagingGroupAgents(mg.id);
  for (const agent of agents) {
    const mode = effectiveSessionMode(agent, mg);
    const lookupThread = mode === 'per-thread' ? threadId : null;
    const { session } = resolveSession(agent.agent_group_id, mg.id, lookupThread, mode);
    await syncSessionFromSlack(session);
  }
}

export async function syncSlackInboundPreRoute(mg: MessagingGroup, event: InboundEvent): Promise<void> {
  if (event.channelType !== 'slack') return;
  await syncSlackAgentsForMessagingGroup(mg, event.platformId, event.threadId);
}

export async function syncMentionStickyThreadAfterOutbound(
  mg: MessagingGroup,
  platformId: string,
  threadId: string | null,
): Promise<void> {
  if (!threadId || mg.channel_type !== 'slack') return;
  const stickyAgents = getMessagingGroupAgents(mg.id).filter((a) => a.engage_mode === 'mention-sticky');
  for (const agent of stickyAgents) {
    const mode = effectiveSessionMode(agent, mg);
    const { session } = resolveSession(agent.agent_group_id, mg.id, threadId, mode);
    await syncSessionFromSlack(session);
  }
}

export async function startupSlackReconciliation(): Promise<void> {
  if (!getSlackToken()) {
    log.debug('Slack history sync skipped — no SLACK_BOT_TOKEN');
    return;
  }

  const sessions = getActiveSessions().filter((s) => {
    if (!s.messaging_group_id) return false;
    const mg = getMessagingGroup(s.messaging_group_id);
    return mg?.channel_type === 'slack';
  });

  log.info('Slack history sync: startup reconciliation', { sessionCount: sessions.length });
  for (const session of sessions) {
    await syncSessionFromSlack(session);
    await sleep(RATE_LIMIT_DELAY_MS);
  }
  log.info('Slack history sync: startup reconciliation complete');
}

export function startSlackHistoryPeriodicSync(): void {
  if (periodicTimer || !getSlackToken()) return;
  periodicTimer = setInterval(() => {
    void startupSlackReconciliation().catch((err) => {
      log.warn('Periodic Slack history sync failed', { err });
    });
  }, SYNC_INTERVAL_MS);
  log.info('Slack history sync: periodic started', { intervalMs: SYNC_INTERVAL_MS });
}

export function stopSlackHistoryPeriodicSync(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
