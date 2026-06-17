import { describe, expect, it } from 'vitest';

import { scoreCapabilityReply } from './post-upgrade/utils/capability-score.js';

describe('scoreCapabilityReply', () => {
  it('fails generic no-memory disclaimers', () => {
    expect(
      scoreCapabilityReply(
        "No. I don't learn or grow between sessions. Each conversation is independent for me.",
      ),
    ).toBe('fail');
  });

  it('passes user-facing capability answers', () => {
    expect(
      scoreCapabilityReply(
        'Yes — I persist notes in CLAUDE.local.md, mnemon, and the wiki when we save things.',
      ),
    ).toBe('pass');
  });

  it('warns when reply mixes denial and affirmation', () => {
    expect(
      scoreCapabilityReply(
        "I don't remember everything automatically, but I can save to mnemon and wiki.",
      ),
    ).toBe('warn');
  });
});
