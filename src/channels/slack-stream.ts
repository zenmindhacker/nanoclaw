/**
 * Slack assistant DM streaming — keeps the composer usable while the agent works.
 *
 * Uses @chat-adapter/slack's native stream() API (chat.startStream / append / stop).
 * Falls back to normal postMessage when metadata or thread context is missing.
 */

import type { Adapter, StreamChunk } from 'chat';

import { log } from '../log.js';
import type { ChannelAdapter, OutboundMessage } from './adapter.js';
import {
  canCompleteViaStream,
  extractDeliverableText,
  parseSlackStreamMeta,
  type SessionActivityCompleteResult,
  type SessionActivityContext,
  type SlackInboundStreamMeta,
} from './session-activity.js';

type SlackStreamAdapter = Adapter & {
  stream?(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    options?: {
      recipientUserId?: string;
      recipientTeamId?: string;
      taskDisplayMode?: 'timeline' | 'plan';
    },
  ): Promise<{ id?: string } | undefined>;
  setAssistantStatus?(channel: string, threadTs: string, status: string): Promise<void>;
};

const THINKING_CHUNK: StreamChunk = {
  type: 'task_update',
  id: 'nanoclaw-thinking',
  title: 'Thinking…',
  status: 'in_progress',
};

export function decodeSlackThreadId(threadId: string): { channel: string; threadTs: string } | null {
  if (!threadId.startsWith('slack:')) return null;
  const rest = threadId.slice('slack:'.length);
  const sep = rest.indexOf(':');
  if (sep === -1) return { channel: rest, threadTs: '' };
  return { channel: rest.slice(0, sep), threadTs: rest.slice(sep + 1) };
}

/** Async iterable fed incrementally until the final outbound reply completes the stream. */
export class AsyncStreamFeed implements AsyncIterable<string | StreamChunk> {
  private queue: (string | StreamChunk)[] = [];
  private notify: (() => void) | null = null;
  private closed = false;

  push(chunk: string | StreamChunk): void {
    if (this.closed) return;
    this.queue.push(chunk);
    this.notify?.();
  }

  end(): void {
    this.closed = true;
    this.notify?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string | StreamChunk> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.notify = resolve;
      });
      this.notify = null;
    }
  }
}

interface SlackStreamSession {
  feed: AsyncStreamFeed;
  streamThreadId: string;
  streamPromise: Promise<{ id?: string } | undefined>;
}

function resolveStreamThreadId(threadId: string, meta: SlackInboundStreamMeta): string {
  const decoded = decodeSlackThreadId(threadId);
  if (!decoded) return threadId;
  if (decoded.threadTs) return threadId;
  const ts = meta.slackStreamThreadTs;
  if (ts) return `slack:${decoded.channel}:${ts}`;
  return threadId;
}

function isStreamUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('requires recipientUserId') ||
    msg.includes('requires a valid thread context') ||
    msg.includes('not_supported') ||
    msg.includes('method_not_supported')
  );
}

export interface SlackSessionActivityHandles {
  cancelByThread: (threadId: string) => void;
  clearAssistantStatus: (threadId: string) => Promise<void>;
}

export function attachSlackSessionActivity(
  bridge: ChannelAdapter,
  slackAdapter: SlackStreamAdapter,
): SlackSessionActivityHandles {
  const sessions = new Map<string, SlackStreamSession>();

  async function clearAssistantStatus(threadId: string): Promise<void> {
    const decoded = decodeSlackThreadId(threadId);
    if (!decoded?.threadTs || !slackAdapter.setAssistantStatus) return;
    try {
      await slackAdapter.setAssistantStatus(decoded.channel, decoded.threadTs, '');
    } catch (err) {
      log.debug('Slack assistant status clear failed', { threadId, err });
    }
  }

  function cancelSession(sessionId: string, reason: string): void {
    const state = sessions.get(sessionId);
    if (!state) return;
    sessions.delete(sessionId);
    state.feed.end();
    void state.streamPromise.catch((err) => {
      log.debug('Slack stream cancelled', { sessionId, reason, err });
    });
  }

  function cancelByThread(threadId: string): void {
    for (const [sessionId, state] of sessions) {
      if (state.streamThreadId === threadId) {
        cancelSession(sessionId, 'thread-replaced');
      }
    }
  }

  bridge.startSessionActivity = async (ctx: SessionActivityContext, rawMeta: Record<string, unknown>) => {
    const meta = parseSlackStreamMeta(rawMeta);
    if (meta.isGroup) return;

    const recipientUserId = meta.slackRecipientUserId;
    const recipientTeamId = meta.slackRecipientTeamId;
    if (!recipientUserId || !recipientTeamId) {
      log.debug('Slack stream skipped — missing recipient metadata', { sessionId: ctx.sessionId });
      return;
    }

    if (!slackAdapter.stream) {
      log.debug('Slack stream skipped — adapter has no stream()', { sessionId: ctx.sessionId });
      return;
    }

    const tid = ctx.threadId ?? ctx.platformId;
    const streamThreadId = resolveStreamThreadId(tid, meta);
    const decoded = decodeSlackThreadId(streamThreadId);
    if (!decoded?.threadTs) {
      log.debug('Slack stream skipped — no thread ts', { sessionId: ctx.sessionId, streamThreadId });
      return;
    }

    const existing = sessions.get(ctx.sessionId);
    if (existing) {
      log.debug('Slack stream already active; keeping existing stream for follow-up', {
        sessionId: ctx.sessionId,
        streamThreadId: existing.streamThreadId,
      });
      return;
    }

    // Short loading bridge; first stream append clears assistant status in Slack.
    if (slackAdapter.setAssistantStatus) {
      try {
        await slackAdapter.setAssistantStatus(decoded.channel, decoded.threadTs, 'Typing...');
      } catch (err) {
        log.debug('Slack assistant status bridge failed', { sessionId: ctx.sessionId, err });
      }
    }

    const feed = new AsyncStreamFeed();
    feed.push(THINKING_CHUNK);

    const streamPromise = slackAdapter
      .stream(streamThreadId, feed, {
        recipientUserId,
        recipientTeamId,
        taskDisplayMode: 'timeline',
      })
      .catch((err) => {
        if (!isStreamUnsupportedError(err)) {
          log.warn('Slack stream failed', { sessionId: ctx.sessionId, err });
        } else {
          log.debug('Slack stream unavailable', { sessionId: ctx.sessionId, err });
        }
        sessions.delete(ctx.sessionId);
        throw err;
      });

    sessions.set(ctx.sessionId, { feed, streamThreadId, streamPromise });
    void streamPromise
      .then(() => {
        log.debug('Slack stream finished', { sessionId: ctx.sessionId });
      })
      .catch(() => {
        // The owning lifecycle handles fallback/logging; avoid an unhandled
        // rejection from this observer promise if Slack rejects the stream.
      });
  };

  bridge.completeSessionActivity = async (
    sessionId: string,
    message: OutboundMessage,
  ): Promise<SessionActivityCompleteResult> => {
    const state = sessions.get(sessionId);
    if (!state) return null;
    if (!canCompleteViaStream(message)) {
      cancelSession(sessionId, 'non-streamable-outbound');
      return null;
    }

    const content = message.content as Record<string, unknown>;
    const text = extractDeliverableText(content);
    if (!text) {
      cancelSession(sessionId, 'empty-text');
      return null;
    }

    state.feed.push({ type: 'markdown_text', text });
    state.feed.end();

    try {
      const result = await state.streamPromise;
      sessions.delete(sessionId);
      await clearAssistantStatus(state.streamThreadId);
      return result?.id;
    } catch (err) {
      sessions.delete(sessionId);
      log.warn('Slack stream complete failed, falling back to postMessage', { sessionId, err });
      return null;
    }
  };

  bridge.cancelSessionActivity = async (sessionId: string) => {
    const state = sessions.get(sessionId);
    if (!state) return;
    cancelSession(sessionId, 'cancelled');
    await clearAssistantStatus(state.streamThreadId);
  };

  return { cancelByThread, clearAssistantStatus };
}
