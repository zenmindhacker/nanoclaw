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
