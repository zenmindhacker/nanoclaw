import { describe, expect, it, vi } from 'vitest';

import type { ChannelAdapter } from './adapter.js';
import { attachSlackSessionActivity, decodeSlackThreadId, normalizeEmptySlackThreadId } from './slack-stream.js';

describe('normalizeEmptySlackThreadId', () => {
  it('fills empty agent_view DM roots from slackStreamThreadTs for reply targeting', () => {
    expect(
      normalizeEmptySlackThreadId('slack:D0AFGMS9UE6:', {
        content: JSON.stringify({ slackStreamThreadTs: '1784993860.123456' }),
      }),
    ).toBe('slack:D0AFGMS9UE6:1784993860.123456');
  });

  it('leaves real threads alone', () => {
    expect(normalizeEmptySlackThreadId('slack:C1:1781715627.799729')).toBe('slack:C1:1781715627.799729');
  });
});

describe('decodeSlackThreadId', () => {
  it('parses channel and thread ts', () => {
    expect(decodeSlackThreadId('slack:D0AFGMS9UE6:1784993860.123456')).toEqual({
      channel: 'D0AFGMS9UE6',
      threadTs: '1784993860.123456',
    });
  });
});

describe('attachSlackSessionActivity — thread-aware streams', () => {
  it('replaces an active stream when the wake thread ts changes', async () => {
    const setStatus = vi.fn().mockResolvedValue(undefined);
    const stream = vi.fn().mockImplementation(async (_tid: string, feed: AsyncIterable<unknown>) => {
      // Consume until end so complete/cancel can settle.
      void (async () => {
        for await (const _ of feed) {
          /* drain */
        }
      })();
      return { id: 'stream-msg' };
    });

    const slackAdapter = {
      stream,
      setAssistantStatus: setStatus,
    };

    const bridge = {} as ChannelAdapter;
    attachSlackSessionActivity(bridge, slackAdapter as never);

    const baseCtx = {
      sessionId: 'sess-dm',
      agentGroupId: 'ag-1',
      channelType: 'slack',
      platformId: 'slack:D0AFGMS9UE6',
      threadId: 'slack:D0AFGMS9UE6:111.001',
    };

    await bridge.startSessionActivity?.(baseCtx, {
      slackRecipientUserId: 'U_USER',
      slackRecipientTeamId: 'T_TEAM',
      slackStreamThreadTs: '111.001',
    });
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toBe('slack:D0AFGMS9UE6:111.001');

    await bridge.startSessionActivity?.(
      { ...baseCtx, threadId: 'slack:D0AFGMS9UE6:222.002' },
      {
        slackRecipientUserId: 'U_USER',
        slackRecipientTeamId: 'T_TEAM',
        slackStreamThreadTs: '222.002',
      },
    );
    expect(stream).toHaveBeenCalledTimes(2);
    expect(stream.mock.calls[1][0]).toBe('slack:D0AFGMS9UE6:222.002');
  });

  it('keeps the existing stream when the same thread wakes again', async () => {
    const stream = vi.fn().mockImplementation(async (_tid: string, feed: AsyncIterable<unknown>) => {
      void (async () => {
        for await (const _ of feed) {
          /* drain */
        }
      })();
      return { id: 'stream-msg' };
    });

    const bridge = {} as ChannelAdapter;
    attachSlackSessionActivity(bridge, {
      stream,
      setAssistantStatus: vi.fn().mockResolvedValue(undefined),
    } as never);

    const ctx = {
      sessionId: 'sess-dm',
      agentGroupId: 'ag-1',
      channelType: 'slack',
      platformId: 'slack:D0AFGMS9UE6',
      threadId: 'slack:D0AFGMS9UE6:111.001',
    };
    const meta = {
      slackRecipientUserId: 'U_USER',
      slackRecipientTeamId: 'T_TEAM',
      slackStreamThreadTs: '111.001',
    };

    await bridge.startSessionActivity?.(ctx, meta);
    await bridge.startSessionActivity?.(ctx, meta);
    expect(stream).toHaveBeenCalledTimes(1);
  });
});
