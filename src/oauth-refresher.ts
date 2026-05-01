/**
 * Host-side OAuth token refresher.
 *
 * Runs on a timer in the NanoClaw main process, proactively refreshing
 * all OAuth tokens before they expire. Containers mount credential files
 * as read-only, so all refresh logic must live on the host.
 *
 * Pattern follows credential-proxy.ts: timer, structured logging, atomic writes.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { request as httpsRequest } from 'https';

import { logger } from './logger.js';

const CRED_DIR = path.join(
  os.homedir(),
  '.config',
  'nanoclaw',
  'credentials',
  'services',
);
const REGISTRY_PATH = path.join(CRED_DIR, 'oauth-registry.json');

/** Refresh when less than this many seconds remain. */
/** Refresh when less than this many seconds remain. Must exceed CHECK_INTERVAL
 *  so tokens cannot expire between cycles (30 min interval → 35 min buffer). */
const REFRESH_BUFFER_SEC = 35 * 60;
/** Check all tokens on this interval. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegistryEntry {
  id: string;
  token_file: string;
  provider: string;
  token_url: string;
  client_file: string;
  auth_method: 'post_body' | 'basic_auth';
  account: string;
  org: string;
  description?: string;
}

interface OAuthRegistry {
  version: number;
  tokens: RegistryEntry[];
}

interface TokenFile {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expiry_date?: number;
  expires_in?: number;
  [key: string]: unknown;
}

interface ClientCredentials {
  client_id: string;
  client_secret: string;
}

export interface TokenHealth {
  id: string;
  account: string;
  org: string;
  expiresInMin: number;
  status: 'ok' | 'expiring' | 'expired' | 'error';
  error?: string;
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

function loadRegistry(): OAuthRegistry | null {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function loadTokenFile(filename: string): TokenFile | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CRED_DIR, filename), 'utf-8'));
  } catch {
    return null;
  }
}

function loadClientCredentials(filename: string): ClientCredentials | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(CRED_DIR, filename), 'utf-8'),
    );
    // Google uses { installed: { client_id, client_secret } }
    // Xero uses flat { client_id, client_secret }
    const creds = raw.installed || raw.web || raw;
    if (creds.client_id && creds.client_secret) return creds;
    return null;
  } catch {
    return null;
  }
}

/** Atomic write: write to .tmp then rename to avoid corrupted reads. */
function saveTokenFile(filename: string, token: TokenFile): void {
  const filePath = path.join(CRED_DIR, filename);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(token, null, 2));
  fs.renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function postForm(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname,
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => {
          raw += c.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Non-JSON response: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Token expiry helper
// ---------------------------------------------------------------------------

function getExpiresAtSec(token: TokenFile): number {
  if (token.expires_at) return token.expires_at;
  if (token.expiry_date) return Math.floor(token.expiry_date / 1000);
  return 0;
}

// ---------------------------------------------------------------------------
// Provider-specific refresh
// ---------------------------------------------------------------------------

async function refreshToken(
  entry: RegistryEntry,
  token: TokenFile,
  creds: ClientCredentials,
): Promise<TokenFile | null> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    ...(entry.auth_method === 'post_body' && {
      client_id: creds.client_id,
      client_secret: creds.client_secret,
    }),
  }).toString();

  const headers: Record<string, string> = {};
  if (entry.auth_method === 'basic_auth') {
    headers['authorization'] =
      'Basic ' +
      Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString(
        'base64',
      );
  }

  const json = await postForm(entry.token_url, body, headers);

  if (json.error) {
    logger.error(
      { id: entry.id, error: json.error, desc: json.error_description },
      'OAuth token refresh failed',
    );
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresIn = Number(json.expires_in) || 3600;
  const expiresAt = nowSec + expiresIn;

  // Merge into existing token, preserving metadata and extra fields
  const updated: TokenFile = {
    ...token,
    access_token: json.access_token as string,
    refresh_token: (json.refresh_token as string) || token.refresh_token,
    expires_at: expiresAt,
    expires_in: expiresIn,
  };

  // Google tokens: also write expiry_date (ms) for googleapis library compat
  if (entry.provider === 'google') {
    updated.expiry_date = expiresAt * 1000;
  }

  // Preserve id_token if provider returns one (Xero does)
  if (json.id_token) {
    updated.id_token = json.id_token;
  }

  // Preserve scope if returned
  if (json.scope) {
    updated.scope = json.scope;
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Core refresh loop
// ---------------------------------------------------------------------------

async function checkAndRefreshAll(): Promise<void> {
  const registry = loadRegistry();
  if (!registry) {
    logger.warn('OAuth registry not found, skipping refresh cycle');
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  for (const entry of registry.tokens) {
    const token = loadTokenFile(entry.token_file);
    if (!token) {
      logger.warn({ id: entry.id }, 'Token file not found, skipping');
      continue;
    }
    if (!token.refresh_token) {
      logger.warn({ id: entry.id }, 'No refresh_token, skipping');
      continue;
    }

    const expiresAt = getExpiresAtSec(token);
    const remaining = expiresAt - nowSec;

    if (remaining < REFRESH_BUFFER_SEC) {
      logger.info(
        { id: entry.id, account: entry.account, remainingSec: remaining },
        'Token expiring soon, refreshing',
      );

      const creds = loadClientCredentials(entry.client_file);
      if (!creds) {
        logger.error(
          { id: entry.id, clientFile: entry.client_file },
          'Client credentials not found',
        );
        continue;
      }

      try {
        const updated = await refreshToken(entry, token, creds);
        if (updated) {
          saveTokenFile(entry.token_file, updated);
          const expiresInMin = Math.round(
            ((updated.expires_at ?? 0) - nowSec) / 60,
          );
          logger.info(
            {
              id: entry.id,
              account: entry.account,
              expiresInMin,
            },
            'Token refreshed successfully',
          );
          alert(
            `Refreshed *${entry.id}* token (${entry.account}) — valid for ${expiresInMin}m`,
          );
        } else {
          // refreshToken returned null → provider rejected the refresh
          alert(
            `OAuth refresh failed for *${entry.id}* (${entry.account}). ` +
              `Token may need manual re-auth. Check \`${entry.token_file}\`.`,
          );
        }
      } catch (err) {
        logger.error({ id: entry.id, err }, 'Token refresh error');
        alert(
          `OAuth refresh error for *${entry.id}* (${entry.account}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      logger.debug(
        { id: entry.id, remainingMin: Math.round(remaining / 60) },
        'Token still valid',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get health status of all registered OAuth tokens. */
export function getTokenHealth(): TokenHealth[] {
  const registry = loadRegistry();
  const results: TokenHealth[] = [];

  const nowSec = Math.floor(Date.now() / 1000);

  if (registry) {
    for (const entry of registry.tokens) {
      try {
        const token = loadTokenFile(entry.token_file);
        if (!token) {
          results.push({
            id: entry.id,
            account: entry.account,
            org: entry.org,
            expiresInMin: 0,
            status: 'error' as const,
            error: 'Token file not found',
          });
          continue;
        }
        const expiresAt = getExpiresAtSec(token);
        const remainingMin = Math.round((expiresAt - nowSec) / 60);
        const status: TokenHealth['status'] =
          remainingMin > 10 ? 'ok' : remainingMin > 0 ? 'expiring' : 'expired';
        results.push({
          id: entry.id,
          account: entry.account,
          org: entry.org,
          expiresInMin: remainingMin,
          status,
        });
      } catch (err) {
        results.push({
          id: entry.id,
          account: entry.account,
          org: entry.org,
          expiresInMin: 0,
          status: 'error' as const,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return results;
}

let refreshInterval: ReturnType<typeof setInterval> | null = null;
let alertCallback: ((msg: string) => void) | null = null;

/** Fire a best-effort alert to sysops (non-blocking). */
function alert(msg: string): void {
  if (alertCallback) {
    try {
      alertCallback(msg);
    } catch {
      /* best-effort */
    }
  }
}

export function startOAuthRefresher(opts?: {
  onAlert?: (msg: string) => void;
}): void {
  if (refreshInterval) return;
  alertCallback = opts?.onAlert ?? null;
  logger.info('OAuth token refresher started');
  // Run immediately, then on interval
  checkAndRefreshAll().catch((err) =>
    logger.error({ err }, 'OAuth refresh error on startup'),
  );
  refreshInterval = setInterval(() => {
    checkAndRefreshAll().catch((err) =>
      logger.error({ err }, 'OAuth refresh error'),
    );
  }, CHECK_INTERVAL_MS);
}

export function stopOAuthRefresher(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    logger.info('OAuth token refresher stopped');
  }
}
