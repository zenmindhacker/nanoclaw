import { describe, expect, it } from 'vitest';

import { decodeSlackThreadId } from '../../channels/slack-stream.js';

describe('Slack history sync helpers', () => {
  it('decodeSlackThreadId parses channel thread ids', () => {
    const decoded = decodeSlackThreadId('slack:C07F195GB96:1781715627.799729');
    expect(decoded).toEqual({ channel: 'C07F195GB96', threadTs: '1781715627.799729' });
  });

  it('decodeSlackThreadId parses bare channel ids', () => {
    const decoded = decodeSlackThreadId('slack:D0AFGMS9UE6');
    expect(decoded).toEqual({ channel: 'D0AFGMS9UE6', threadTs: '' });
  });

  it('history message ids are stable per Slack ts', () => {
    const ts = '1781715627.799729';
    expect(`slack-sync:${ts}`).toBe('slack-sync:1781715627.799729');
  });
});
