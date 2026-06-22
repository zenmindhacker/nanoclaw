import { describe, expect, it } from 'vitest';

import { normalizeOAuthTokenShape } from './refresher.js';

describe('normalizeOAuthTokenShape', () => {
  it('returns flat tokens unchanged', () => {
    const flat = {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: 1_800_000_000,
      account: 'hello@connectedtutors.org',
    };
    expect(normalizeOAuthTokenShape(flat)).toEqual(flat);
  });

  it('unwraps OpenCode normal wrapper', () => {
    const inner = {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_at: 1_800_000_000,
      account: 'hello@connectedtutors.org',
    };
    expect(normalizeOAuthTokenShape({ normal: inner })).toEqual(inner);
  });

  it('ignores normal key without oauth fields', () => {
    const flat = { access_token: 'tok', expires_at: 1_800_000_000 };
    expect(normalizeOAuthTokenShape({ normal: { foo: 'bar' }, ...flat })).toEqual(flat);
  });
});
