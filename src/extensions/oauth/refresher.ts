/**
 * Host-side OAuth token refresher.
 *
 * Containers mount credential files read-only, so refresh-token rotation for
 * local token JSON files must happen in the host process.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { request as httpsRequest } from 'https';

import { log } from '../../log.js';

const CRED_DIR = path.join(os.homedir(), '.config', 'nanoclaw', 'credentials', 'services');
const REGISTRY_PATH = path.join(CRED_DIR, 'oauth-registry.json');

// Must exceed CHECK_INTERVAL so short-lived tokens cannot expire between cycles.
// Xero tokens have a 30-minute TTL; 15-minute checks with a 25-minute buffer
// ensures xero is always refreshed ~15 minutes before expiry rather than
// racing to refresh at exactly the expiry boundary.
const REFRESH_BUFFER_SEC = 25 * 60;
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

type AuthMethod = 'post_body' | 'basic_auth';
type Provider = 'google' | 'xero' | string;

interface OAuthRegistry {
  version: number;
  tokens: OAuthRegistryEntry[];
}

interface OAuthRegistryEntry {
  id: string;
  token_file: string;
  provider: Provider;
  token_url: string;
  client_file: string;
  auth_method: AuthMethod;
  account: string;
  org?: string;
  description?: string;
}

interface OAuthTokenFile {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expiry_date?: number;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  [key: string]: unknown;
}

interface OAuthClientCredentials {
  client_id: string;
  client_secret: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
  [key: string]: unknown;
}

export interface TokenHealth {
  id: string;
  account: string;
  org?: string;
  expiresInMin: number;
  status: 'ok' | 'expiring' | 'expired' | 'error';
  error?: string;
}

export interface RefreshResult {
  id: string;
  account: string;
  status: 'refreshed' | 'skipped' | 'failed';
  message?: string;
}

export interface RefreshOptions {
  /** When true, refresh tokens even if still inside the proactive buffer window. */
  force?: boolean;
}

let refreshInterval: NodeJS.Timeout | null = null;
let alertCallback: ((message: string) => void) | null = null;

function loadRegistry(): OAuthRegistry | null {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')) as OAuthRegistry;
  } catch {
    return null;
  }
}

function loadTokenFile(filename: string): OAuthTokenFile | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CRED_DIR, filename), 'utf8')) as OAuthTokenFile;
  } catch {
    return null;
  }
}

function loadClientCredentials(filename: string): OAuthClientCredentials | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CRED_DIR, filename), 'utf8')) as {
      installed?: OAuthClientCredentials;
      web?: OAuthClientCredentials;
      client_id?: string;
      client_secret?: string;
    };
    const creds = raw.installed ?? raw.web ?? raw;
    if (creds.client_id && creds.client_secret) {
      return { client_id: creds.client_id, client_secret: creds.client_secret };
    }
    return null;
  } catch {
    return null;
  }
}

function saveTokenFile(filename: string, token: OAuthTokenFile): void {
  const filePath = path.join(CRED_DIR, filename);
  const tmpPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(token, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function postForm(url: string, body: string, headers: Record<string, string>): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw) as TokenResponse);
          } catch {
            reject(new Error(`Non-JSON OAuth response: ${raw.slice(0, 200)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getExpiresAtSec(token: OAuthTokenFile): number {
  if (token.expires_at) return token.expires_at;
  if (token.expiry_date) return Math.floor(token.expiry_date / 1000);
  return 0;
}

function emitAlert(message: string): void {
  if (!alertCallback) return;
  try {
    alertCallback(message);
  } catch {
    // Best effort only; refresh should not fail because alert delivery failed.
  }
}

async function refreshToken(
  entry: OAuthRegistryEntry,
  token: OAuthTokenFile,
  creds: OAuthClientCredentials,
): Promise<OAuthTokenFile | null> {
  if (!token.refresh_token) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    ...(entry.auth_method === 'post_body'
      ? {
          client_id: creds.client_id,
          client_secret: creds.client_secret,
        }
      : {}),
  }).toString();

  const headers: Record<string, string> = {};
  if (entry.auth_method === 'basic_auth') {
    headers.authorization = `Basic ${Buffer.from(`${creds.client_id}:${creds.client_secret}`).toString('base64')}`;
  }

  const json = await postForm(entry.token_url, body, headers);
  if (json.error) {
    log.error('OAuth token refresh failed', {
      id: entry.id,
      error: json.error,
      description: json.error_description,
    });
    return null;
  }
  if (!json.access_token) {
    log.error('OAuth token refresh response missing access_token', { id: entry.id });
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expiresIn = Number(json.expires_in) || 3600;
  const expiresAt = nowSec + expiresIn;

  const updated: OAuthTokenFile = {
    ...token,
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? token.refresh_token,
    expires_at: expiresAt,
    expires_in: expiresIn,
  };

  if (entry.provider === 'google') {
    updated.expiry_date = expiresAt * 1000;
  }
  if (json.id_token) {
    updated.id_token = json.id_token;
  }
  if (json.scope) {
    updated.scope = json.scope;
  }

  return updated;
}

async function refreshRegistryEntry(entry: OAuthRegistryEntry, opts: RefreshOptions = {}): Promise<RefreshResult> {
  const nowSec = Math.floor(Date.now() / 1000);
  const token = loadTokenFile(entry.token_file);
  if (!token) {
    log.warn('OAuth token file not found; skipping', { id: entry.id, tokenFile: entry.token_file });
    return { id: entry.id, account: entry.account, status: 'failed', message: 'Token file not found' };
  }
  if (!token.refresh_token) {
    log.warn('OAuth token has no refresh_token; skipping', { id: entry.id, tokenFile: entry.token_file });
    const message = `OAuth token *${entry.id}* (${entry.account}) has no refresh token and needs re-auth.`;
    emitAlert(message);
    return { id: entry.id, account: entry.account, status: 'failed', message };
  }

  const remainingSec = getExpiresAtSec(token) - nowSec;
  if (!opts.force && remainingSec >= REFRESH_BUFFER_SEC) {
    log.debug('OAuth token still valid', { id: entry.id, remainingMin: Math.round(remainingSec / 60) });
    return {
      id: entry.id,
      account: entry.account,
      status: 'skipped',
      message: `Still valid for ${Math.round(remainingSec / 60)}m`,
    };
  }

  const creds = loadClientCredentials(entry.client_file);
  if (!creds) {
    log.error('OAuth client credentials not found', { id: entry.id, clientFile: entry.client_file });
    const message = `OAuth client credentials missing for *${entry.id}* (${entry.account}).`;
    emitAlert(message);
    return { id: entry.id, account: entry.account, status: 'failed', message };
  }

  log.info('OAuth token expiring soon; refreshing', { id: entry.id, account: entry.account, remainingSec });
  try {
    const updated = await refreshToken(entry, token, creds);
    if (!updated) {
      const message = `OAuth refresh failed for *${entry.id}* (${entry.account}). Token may need manual re-auth; check ${entry.token_file}.`;
      emitAlert(message);
      return { id: entry.id, account: entry.account, status: 'failed', message };
    }

    saveTokenFile(entry.token_file, updated);
    log.info('OAuth token refreshed', {
      id: entry.id,
      account: entry.account,
      expiresInMin: Math.round((getExpiresAtSec(updated) - nowSec) / 60),
    });
    return {
      id: entry.id,
      account: entry.account,
      status: 'refreshed',
      message: `Expires in ${Math.round((getExpiresAtSec(updated) - nowSec) / 60)}m`,
    };
  } catch (err) {
    log.error('OAuth token refresh error', { id: entry.id, err });
    const message = `OAuth refresh error for *${entry.id}* (${entry.account}): ${err instanceof Error ? err.message : String(err)}`;
    emitAlert(message);
    return { id: entry.id, account: entry.account, status: 'failed', message };
  }
}

async function checkAndRefreshAll(opts: RefreshOptions = {}): Promise<RefreshResult[]> {
  const registry = loadRegistry();
  if (!registry) {
    log.debug('OAuth registry not found; skipping refresh cycle');
    return [];
  }

  const results: RefreshResult[] = [];
  for (const entry of registry.tokens) {
    results.push(await refreshRegistryEntry(entry, opts));
  }
  return results;
}

/** Force-refresh all registry tokens that are due or expired. */
export async function refreshAllNow(): Promise<RefreshResult[]> {
  return checkAndRefreshAll({ force: true });
}

/** Force-refresh a single registry token by id. */
export async function refreshTokenById(id: string): Promise<RefreshResult> {
  const registry = loadRegistry();
  if (!registry) {
    throw new Error('OAuth registry not found');
  }
  const entry = registry.tokens.find((t) => t.id === id);
  if (!entry) {
    throw new Error(`OAuth token id not found: ${id}`);
  }
  return refreshRegistryEntry(entry, { force: true });
}

export function getTokenHealth(): TokenHealth[] {
  const registry = loadRegistry();
  if (!registry) return [];

  const nowSec = Math.floor(Date.now() / 1000);
  return registry.tokens.map((entry) => {
    try {
      const token = loadTokenFile(entry.token_file);
      if (!token) {
        return {
          id: entry.id,
          account: entry.account,
          org: entry.org,
          expiresInMin: 0,
          status: 'error',
          error: 'Token file not found',
        };
      }

      const expiresInMin = Math.round((getExpiresAtSec(token) - nowSec) / 60);
      const status: TokenHealth['status'] = expiresInMin > 10 ? 'ok' : expiresInMin > 0 ? 'expiring' : 'expired';
      return { id: entry.id, account: entry.account, org: entry.org, expiresInMin, status };
    } catch (err) {
      return {
        id: entry.id,
        account: entry.account,
        org: entry.org,
        expiresInMin: 0,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function startOAuthRefresher(opts?: { onAlert?: (message: string) => void }): void {
  if (refreshInterval) return;
  alertCallback = opts?.onAlert ?? null;
  log.info('OAuth token refresher started');

  checkAndRefreshAll().catch((err) => {
    log.error('OAuth refresh error on startup', { err });
  });
  refreshInterval = setInterval(() => {
    checkAndRefreshAll().catch((err) => {
      log.error('OAuth refresh error', { err });
    });
  }, CHECK_INTERVAL_MS);
}

/** Run one proactive refresh cycle (respects buffer window). */
export async function runRefreshCycle(): Promise<RefreshResult[]> {
  return checkAndRefreshAll();
}

export function stopOAuthRefresher(): void {
  if (!refreshInterval) return;
  clearInterval(refreshInterval);
  refreshInterval = null;
  alertCallback = null;
  log.info('OAuth token refresher stopped');
}
