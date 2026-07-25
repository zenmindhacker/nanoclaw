import { describe, expect, it } from 'vitest';

import { effectiveSessionMode } from './session-manager.js';

describe('effectiveSessionMode', () => {
  it('forces Slack DMs to shared (agent_view per-message threads)', () => {
    expect(
      effectiveSessionMode('per-thread', {
        channelType: 'slack',
        isGroup: false,
        adapterSupportsThreads: true,
      }),
    ).toBe('shared');
  });

  it('preserves agent-shared for Slack DMs', () => {
    expect(
      effectiveSessionMode('agent-shared', {
        channelType: 'slack',
        isGroup: false,
      }),
    ).toBe('agent-shared');
  });

  it('forces group chats on threaded adapters to per-thread', () => {
    expect(
      effectiveSessionMode('shared', {
        channelType: 'slack',
        isGroup: true,
        adapterSupportsThreads: true,
      }),
    ).toBe('per-thread');
  });

  it('leaves non-Slack DM wiring unchanged', () => {
    expect(
      effectiveSessionMode('per-thread', {
        channelType: 'telegram',
        isGroup: false,
      }),
    ).toBe('per-thread');
  });
});
