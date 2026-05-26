import { describe, it, expect, vi } from 'vitest';

import type { ChannelAdapter } from './adapter.js';
import { AsyncStreamFeed, attachSlackSessionActivity, decodeSlackThreadId } from './slack-stream.js';
import { canCompleteViaStream, parseSlackStreamMeta } from './session-activity.js';

describe('decodeSlackThreadId', () => {
  it('decodes channel and thread ts', () => {
    expect(decodeSlackThreadId('slack:D0AQ91FEWE6:1779752425.185389')).toEqual({
      channel: 'D0AQ91FEWE6',
      threadTs: '1779752425.185389',
    });
  });

  it('returns empty threadTs for channel-only ids', () => {
    expect(decodeSlackThreadId('slack:D0AQ91FEWE6')).toEqual({
      channel: 'D0AQ91FEWE6',
      threadTs: '',
    });
  });
});

describe('parseSlackStreamMeta', () => {
  it('extracts slack stream fields', () => {
    expect(
      parseSlackStreamMeta({
        slackRecipientUserId: 'U123',
        slackRecipientTeamId: 'T456',
        slackStreamThreadTs: '1.23',
        isGroup: true,
      }),
    ).toEqual({
      slackRecipientUserId: 'U123',
      slackRecipientTeamId: 'T456',
      slackStreamThreadTs: '1.23',
      isGroup: true,
    });
  });
});

describe('canCompleteViaStream', () => {
  it('allows plain text chat messages', () => {
    expect(
      canCompleteViaStream({
        kind: 'chat',
        content: { text: 'hello' },
      }),
    ).toBe(true);
  });

  it('rejects ask_question and file attachments', () => {
    expect(
      canCompleteViaStream({
        kind: 'chat',
        content: { type: 'ask_question', questionId: 'q1' },
      }),
    ).toBe(false);
    expect(
      canCompleteViaStream({
        kind: 'chat',
        content: { text: 'hi' },
        files: [{ filename: 'a.txt', data: Buffer.from('x') }],
      }),
    ).toBe(false);
  });
});

describe('AsyncStreamFeed', () => {
  it('yields pushed chunks until ended', async () => {
    const feed = new AsyncStreamFeed();
    feed.push('a');
    feed.push({ type: 'markdown_text', text: 'b' });
    feed.end();

    const chunks: unknown[] = [];
    for await (const c of feed) chunks.push(c);
    expect(chunks).toEqual(['a', { type: 'markdown_text', text: 'b' }]);
  });
});

describe('attachSlackSessionActivity', () => {
  it('starts stream for DM metadata and completes with final text', async () => {
    const stream = vi.fn().mockResolvedValue({ id: 'msg-ts-1' });
    const setAssistantStatus = vi.fn().mockResolvedValue(undefined);
    const slackAdapter = { stream, setAssistantStatus };

    const bridge: ChannelAdapter = {
      name: 'slack',
      channelType: 'slack',
      supportsThreads: true,
      setup: async () => {},
      teardown: async () => {},
      isConnected: () => true,
      deliver: async () => 'fallback',
    };

    attachSlackSessionActivity(bridge, slackAdapter as never);

    await bridge.startSessionActivity!(
      {
        sessionId: 'sess-1',
        agentGroupId: 'ag-1',
        channelType: 'slack',
        platformId: 'slack:D0',
        threadId: 'slack:D0:1.0',
      },
      {
        slackRecipientUserId: 'U1',
        slackRecipientTeamId: 'T1',
        isGroup: false,
      },
    );

    expect(setAssistantStatus).toHaveBeenCalledWith('D0', '1.0', 'Typing...');
    expect(stream).toHaveBeenCalledWith(
      'slack:D0:1.0',
      expect.any(AsyncStreamFeed),
      expect.objectContaining({ recipientUserId: 'U1', recipientTeamId: 'T1' }),
    );

    const result = await bridge.completeSessionActivity!('sess-1', {
      kind: 'chat',
      content: { text: 'Final answer' },
    });

    expect(result).toBe('msg-ts-1');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('skips stream for group channels', async () => {
    const stream = vi.fn();
    const bridge: ChannelAdapter = {
      name: 'slack',
      channelType: 'slack',
      supportsThreads: true,
      setup: async () => {},
      teardown: async () => {},
      isConnected: () => true,
      deliver: async () => undefined,
    };

    attachSlackSessionActivity(bridge, { stream } as never);

    await bridge.startSessionActivity!(
      {
        sessionId: 'sess-2',
        agentGroupId: 'ag-1',
        channelType: 'slack',
        platformId: 'slack:C1',
        threadId: 'slack:C1:1.0',
      },
      { slackRecipientUserId: 'U1', slackRecipientTeamId: 'T1', isGroup: true },
    );

    expect(stream).not.toHaveBeenCalled();
    expect(await bridge.completeSessionActivity!('sess-2', { kind: 'chat', content: { text: 'x' } })).toBeNull();
  });

  it('returns null from complete when no active stream', async () => {
    const bridge: ChannelAdapter = {
      name: 'slack',
      channelType: 'slack',
      supportsThreads: true,
      setup: async () => {},
      teardown: async () => {},
      isConnected: () => true,
      deliver: async () => undefined,
    };

    attachSlackSessionActivity(bridge, { stream: vi.fn() } as never);

    expect(await bridge.completeSessionActivity!('missing', { kind: 'chat', content: { text: 'x' } })).toBeNull();
  });
});
