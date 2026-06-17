/**
 * Shared Xero OAuth credential paths and loaders.
 *
 * Host: ~/.config/nanoclaw/credentials/services/ (host refresher writes tokens)
 * Container: /workspace/extra/credentials/services/ (read-only mount)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

export const XERO_CLIENT_FILE = 'xero-oauth-client.json';
export const XERO_TOKENS_FILE = 'xero-tokens.json';

const SETUP_HINT =
  'Set up Xero OAuth on the host: save client credentials to xero-oauth-client.json ' +
  'and tokens to xero-tokens.json under ~/.config/nanoclaw/credentials/services/. ' +
  'The NanoClaw host OAuth refresher renews access tokens automatically.';

/**
 * Resolve a credential filename (container mount, then host services dir).
 */
export function resolveCredPath(filename) {
  const servicesPath = `/workspace/extra/credentials/services/${filename}`;
  if (existsSync(servicesPath)) return servicesPath;

  const containerPath = `/workspace/extra/credentials/${filename}`;
  if (existsSync(containerPath)) return containerPath;

  return resolve(homedir(), '.config', 'nanoclaw', 'credentials', 'services', filename);
}

/**
 * Load OAuth app credentials (client_id, client_secret). Never hardcode secrets in repo.
 */
export function loadXeroClientConfig() {
  const path = resolveCredPath(XERO_CLIENT_FILE);
  if (!existsSync(path)) {
    throw new Error(`Missing ${XERO_CLIENT_FILE} at ${path}. ${SETUP_HINT}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!raw.client_id || !raw.client_secret) {
    throw new Error(`${XERO_CLIENT_FILE} must contain client_id and client_secret. ${SETUP_HINT}`);
  }
  return { client_id: raw.client_id, client_secret: raw.client_secret };
}

/**
 * Load token JSON (access_token, refresh_token, expires_at, …).
 */
export function loadXeroTokens() {
  const path = resolveCredPath(XERO_TOKENS_FILE);
  if (!existsSync(path)) {
    throw new Error(`Missing ${XERO_TOKENS_FILE} at ${path}. ${SETUP_HINT}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Operator/host re-auth only — normal container runs must not write tokens.
 */
export function writeXeroTokens(tokens) {
  const path = resolveCredPath(XERO_TOKENS_FILE);
  writeFileSync(path, JSON.stringify(tokens, null, 2));
  return path;
}

/**
 * True if access token is expired or within 5 minutes of expiry.
 */
export function isXeroTokenExpired(tokens) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt =
    tokens.expires_at ??
    (tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : 0);
  if (!expiresAt) return false;
  return expiresAt <= now + 300;
}

/**
 * Fail fast when token is stale — host refresher owns renewal in production.
 */
export function assertXeroTokenFresh(tokens) {
  if (isXeroTokenExpired(tokens)) {
    throw new Error(
      `Xero access token is expired or expiring soon. Wait for the host OAuth refresher ` +
        `or run an operator re-auth script on the host. ${SETUP_HINT}`,
    );
  }
}
