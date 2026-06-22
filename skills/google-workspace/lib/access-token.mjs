#!/usr/bin/env node
/**
 * Return a valid access token for a host-managed Google OAuth registry id.
 * Read-only — host refresher owns token writes.
 */
import { fileURLToPath } from 'url';

import { normalizeOAuthTokenShape, tokenExpiresAt } from './normalize-token.mjs';
import { readTokenFile } from './resolve-google-creds.mjs';

const cache = new Map();

export function getAccessToken(registryId, { cacheMs = 30_000 } = {}) {
  const now = Date.now();
  const hit = cache.get(registryId);
  if (hit && now - hit.at < cacheMs) return hit.token;

  const raw = readTokenFile(registryId);
  const token = normalizeOAuthTokenShape(raw);
  const accessToken = token.access_token;
  if (!accessToken) {
    throw new Error(
      `No access_token in token file for ${registryId}. Run: ncl oauth-refresh-one --id ${registryId}`,
    );
  }

  const expiresAt = tokenExpiresAt(token);
  const nowSec = Math.floor(now / 1000);
  if (expiresAt !== null && expiresAt < nowSec + 60) {
    throw new Error(
      `Google token for ${registryId} is expired or near expiry. Host must refresh: ncl oauth-refresh-one --id ${registryId}`,
    );
  }

  cache.set(registryId, { token: accessToken, at: now });
  return accessToken;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const registryId = process.argv[2];
  if (!registryId) {
    console.error('Usage: access-token.mjs <registry-id>');
    process.exit(1);
  }
  try {
    process.stdout.write(getAccessToken(registryId));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
