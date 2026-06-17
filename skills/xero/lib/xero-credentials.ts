/**
 * TypeScript credential loader (same paths as xero-credentials.mjs).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

export const XERO_CLIENT_FILE = 'xero-oauth-client.json';
export const XERO_TOKENS_FILE = 'xero-tokens.json';

const SETUP_HINT =
  'Set up Xero OAuth on the host: xero-oauth-client.json and xero-tokens.json under ' +
  '~/.config/nanoclaw/credentials/services/.';

export function resolveCredPath(filename: string): string {
  const servicesPath = `/workspace/extra/credentials/services/${filename}`;
  if (existsSync(servicesPath)) return servicesPath;

  const containerPath = `/workspace/extra/credentials/${filename}`;
  if (existsSync(containerPath)) return containerPath;

  return resolve(homedir(), '.config', 'nanoclaw', 'credentials', 'services', filename);
}

export function loadXeroClientConfig(): { client_id: string; client_secret: string } {
  const path = resolveCredPath(XERO_CLIENT_FILE);
  if (!existsSync(path)) {
    throw new Error(`Missing ${XERO_CLIENT_FILE} at ${path}. ${SETUP_HINT}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!raw.client_id || !raw.client_secret) {
    throw new Error(`${XERO_CLIENT_FILE} must contain client_id and client_secret. ${SETUP_HINT}`);
  }
  return { client_id: raw.client_id, client_secret: raw.client_secret };
}

export function loadXeroTokens(): Record<string, unknown> {
  const path = resolveCredPath(XERO_TOKENS_FILE);
  if (!existsSync(path)) {
    throw new Error(`Missing ${XERO_TOKENS_FILE} at ${path}. ${SETUP_HINT}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

export function isXeroTokenExpired(tokens: Record<string, unknown>): boolean {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt =
    (typeof tokens.expires_at === 'number' ? tokens.expires_at : 0) ||
    (typeof tokens.expiry_date === 'number' ? Math.floor(tokens.expiry_date / 1000) : 0);
  if (!expiresAt) return false;
  return expiresAt <= now + 300;
}

export function assertXeroTokenFresh(tokens: Record<string, unknown>): void {
  if (isXeroTokenExpired(tokens)) {
    throw new Error(
      `Xero access token is expired or expiring soon. Host OAuth refresher will renew it. ${SETUP_HINT}`,
    );
  }
}
