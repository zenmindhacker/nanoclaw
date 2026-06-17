/**
 * Optional per-session activity/stream lifecycle for channel adapters.
 *
 * Used by Slack assistant DMs: a short status bridge plus a native chat stream
 * keeps the composer usable while the agent works. Other channels omit these
 * hooks and rely on setTyping / normal deliver.
 */

import type { OutboundMessage } from './adapter.js';

export interface SessionActivityContext {
  sessionId: string;
  agentGroupId: string;
  channelType: string;
  platformId: string;
  threadId: string | null;
}

/** Minimal Slack metadata persisted on inbound chat-sdk content. */
export interface SlackInboundStreamMeta {
  slackRecipientUserId?: string;
  slackRecipientTeamId?: string;
  /** thread_ts or message ts — used when encoded threadId has an empty threadTs segment. */
  slackStreamThreadTs?: string;
  isGroup?: boolean;
}

/**
 * Result of attempting to finish an active stream with the final outbound payload.
 * - `string` — stream completed; platform message id when available
 * - `null` — no active stream or stream not applicable; caller should use deliver()
 */
export type SessionActivityCompleteResult = string | undefined | null;

export function parseSlackStreamMeta(meta: Record<string, unknown>): SlackInboundStreamMeta {
  return {
    slackRecipientUserId: typeof meta.slackRecipientUserId === 'string' ? meta.slackRecipientUserId : undefined,
    slackRecipientTeamId: typeof meta.slackRecipientTeamId === 'string' ? meta.slackRecipientTeamId : undefined,
    slackStreamThreadTs: typeof meta.slackStreamThreadTs === 'string' ? meta.slackStreamThreadTs : undefined,
    isGroup: meta.isGroup === true,
  };
}

export function extractDeliverableText(content: Record<string, unknown>): string | null {
  if (content.operation || content.type === 'ask_question' || content.type === 'card') {
    return null;
  }
  const raw = (content.markdown as string) || (content.text as string);
  return raw && raw.length > 0 ? raw : null;
}

export function canCompleteViaStream(message: OutboundMessage): boolean {
  const content = message.content as Record<string, unknown>;
  if (message.files && message.files.length > 0) return false;
  return extractDeliverableText(content) !== null;
}

/** Slack Thinking Steps — observable tool/work milestones only (not chain-of-thought). */
export type StreamTaskStatus = 'pending' | 'in_progress' | 'complete' | 'error';

export interface StreamTaskProgress {
  taskId: string;
  title: string;
  status: StreamTaskStatus;
  details?: string;
  output?: string;
}

export function parseStreamTaskProgress(content: unknown): StreamTaskProgress | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;
  const title = typeof c.title === 'string' ? c.title.trim() : '';
  if (!title) return null;

  const statusRaw = c.status;
  const status: StreamTaskStatus =
    statusRaw === 'pending' || statusRaw === 'in_progress' || statusRaw === 'complete' || statusRaw === 'error'
      ? statusRaw
      : 'in_progress';

  const taskIdSource = typeof c.taskId === 'string' && c.taskId.trim() ? c.taskId.trim() : title;
  const taskId =
    taskIdSource
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'task';

  return {
    taskId,
    title,
    status,
    details: typeof c.details === 'string' ? c.details : undefined,
    output: typeof c.output === 'string' ? c.output : undefined,
  };
}

/** Status string for assistant.threads.setStatus — Slack renders "AppName {status}". */
export function formatAssistantStatusPhrase(title: string): string {
  const t = title.trim();
  if (!t) return 'is thinking...';
  if (/^is\s+/i.test(t)) return t;
  const lower = t.charAt(0).toLowerCase() + t.slice(1);
  return `is ${lower}`;
}
