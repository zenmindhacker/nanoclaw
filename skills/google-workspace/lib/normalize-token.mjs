/** Unwrap OpenCode-style `{ normal: { access_token, ... } }` token files. */
export function normalizeOAuthTokenShape(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const nested = raw.normal;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    if (nested.access_token || nested.refresh_token) {
      return { ...nested };
    }
  }
  if (nested !== undefined) {
    const { normal: _drop, ...rest } = raw;
    return rest;
  }
  return raw;
}

export function tokenExpiresAt(token) {
  const normalized = normalizeOAuthTokenShape(token);
  if (typeof normalized.expires_at === 'number') return normalized.expires_at;
  if (typeof normalized.expiry_date === 'number') {
    return Math.floor(normalized.expiry_date / 1000);
  }
  return null;
}
