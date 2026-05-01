/**
 * Credential proxy for container isolation.
 * Containers connect here instead of directly to the Anthropic API.
 * The proxy injects real credentials so containers never see them.
 *
 * Two auth modes:
 *   API key:  Proxy injects x-api-key on every request.
 *   OAuth:    Container CLI exchanges its placeholder token for a temp
 *             API key via /api/oauth/claude_cli/create_api_key.
 *             Proxy injects real OAuth token on that exchange request;
 *             subsequent requests carry the temp key which is valid as-is.
 *
 * OAuth tokens are read from ~/.claude/.credentials.json (kept fresh by
 * Claude Code) and refreshed proactively when expiring.
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import { request as httpRequest, RequestOptions } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
/** Refresh proactively when less than this many ms remain.
 *  Must exceed the proactive-check interval (30 min) to guarantee at least
 *  one check falls inside the refresh window before the token expires. */
const REFRESH_BUFFER_MS = 35 * 60 * 1000;

/** Credentials file path used by Claude Code. */
const CRED_FILE = path.join(os.homedir(), '.claude', '.credentials.json');

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

// ---------------------------------------------------------------------------
// OAuth credential management
// ---------------------------------------------------------------------------

interface OAuthCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function readCredentials(): OAuthCreds | null {
  try {
    const data = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8'));
    const o = data?.claudeAiOauth;
    if (o?.accessToken && o?.refreshToken && o?.expiresAt)
      return o as OAuthCreds;
  } catch {
    /* ignore */
  }
  return null;
}

function writeCredentials(creds: OAuthCreds): void {
  try {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8'));
    } catch {
      /* ok */
    }
    data.claudeAiOauth = {
      ...((data.claudeAiOauth as object) || {}),
      ...creds,
    };
    fs.writeFileSync(CRED_FILE, JSON.stringify(data, null, 2));
    logger.info('Refreshed credentials written to file');
  } catch (err) {
    logger.warn({ err }, 'Failed to write refreshed credentials');
  }
}

function fetchJson(
  url: string,
  body: string,
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
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
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

/** In-flight refresh promise — prevents concurrent refresh storms. */
let refreshPromise: Promise<string | null> | null = null;

async function refreshToken(creds: OAuthCreds): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }).toString();
      const json = await fetchJson(CLAUDE_OAUTH_TOKEN_URL, body);
      if (json.error) {
        logger.error({ error: json.error }, 'OAuth token refresh failed');
        consecutiveFailures++;
        // Notify on first failure, then every 5th to avoid spam
        if (
          authFailureNotifier &&
          (consecutiveFailures === 1 || consecutiveFailures % 5 === 0)
        ) {
          const msg =
            json.error === 'invalid_grant'
              ? `⚠️ Claude OAuth token is dead (invalid_grant). I can't process any messages until you re-authenticate. Run \`claude auth login\` on the server.`
              : `⚠️ Claude OAuth refresh failed (${json.error}). Attempt #${consecutiveFailures}. Will keep retrying.`;
          authFailureNotifier(msg);
        }
        return null;
      }
      const next: OAuthCreds = {
        accessToken: json.access_token as string,
        refreshToken: (json.refresh_token as string) || creds.refreshToken,
        expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      };
      writeCredentials(next);
      if (consecutiveFailures > 0) {
        logger.info(
          { previousFailures: consecutiveFailures },
          'OAuth token refreshed successfully (recovered)',
        );
      } else {
        logger.info('OAuth token refreshed successfully');
      }
      consecutiveFailures = 0;
      return next.accessToken;
    } catch (err) {
      logger.error({ err }, 'OAuth token refresh error');
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Returns a valid OAuth access token, refreshing if needed.
 * Reads ~/.claude/.credentials.json fresh each call so Claude Code's own
 * auto-refresh is picked up immediately.
 */
async function getOAuthToken(): Promise<string | null> {
  const creds = readCredentials();
  if (!creds) {
    logger.warn('No OAuth credentials found in ~/.claude/.credentials.json');
    consecutiveFailures++;
    if (authFailureNotifier && consecutiveFailures === 1) {
      authFailureNotifier(
        "⚠️ Claude credentials file is missing (~/.claude/.credentials.json). I'm completely offline until you run `claude auth login` on the server.",
      );
    }
    return null;
  }
  const expiresIn = creds.expiresAt - Date.now();
  if (expiresIn < REFRESH_BUFFER_MS) {
    logger.info(
      { expiresInMs: expiresIn },
      'OAuth token expiring soon, refreshing...',
    );
    const refreshed = await refreshToken(creds);
    return refreshed ?? creds.accessToken; // fall back to existing if refresh fails
  }
  return creds.accessToken;
}

/**
 * Synchronously read the current access token (no refresh).
 * Used by the container runner to inject a valid token at startup.
 */
export function readCurrentAccessToken(): string | null {
  return readCredentials()?.accessToken ?? null;
}

// ---------------------------------------------------------------------------
// Proxy server
// ---------------------------------------------------------------------------

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';

  // For OAuth, prefer reading from .credentials.json (auto-refreshed).
  // Fall back to .env tokens if .credentials.json is unavailable.
  const envOauthToken =
    secrets.CLAUDE_CODE_OAUTH_TOKEN || secrets.ANTHROPIC_AUTH_TOKEN;

  const upstreamUrl = new URL(
    secrets.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  );
  const isHttps = upstreamUrl.protocol === 'https:';
  const makeRequest = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        const body = Buffer.concat(chunks);
        const headers: Record<string, string | number | string[] | undefined> =
          {
            ...(req.headers as Record<string, string>),
            host: upstreamUrl.host,
            'content-length': body.length,
          };

        // Strip hop-by-hop headers that must not be forwarded by proxies
        delete headers['connection'];
        delete headers['keep-alive'];
        delete headers['transfer-encoding'];

        if (authMode === 'api-key') {
          // API key mode: inject x-api-key on every request
          delete headers['x-api-key'];
          headers['x-api-key'] = secrets.ANTHROPIC_API_KEY;
        } else {
          // OAuth mode: replace placeholder Bearer token with the real one
          // only when the container actually sends an Authorization header
          // (exchange request + auth probes). Post-exchange requests use
          // x-api-key only, so they pass through without token injection.
          if (headers['authorization']) {
            delete headers['authorization'];
            // Try live token from .credentials.json (auto-refreshed),
            // fall back to static .env token
            const oauthToken = (await getOAuthToken()) || envOauthToken;
            if (oauthToken) {
              headers['authorization'] = `Bearer ${oauthToken}`;
            }
          }
        }

        const upstream = makeRequest(
          {
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port || (isHttps ? 443 : 80),
            path: req.url,
            method: req.method,
            headers,
          } as RequestOptions,
          (upRes) => {
            res.writeHead(upRes.statusCode!, upRes.headers);
            upRes.pipe(res);
          },
        );

        upstream.on('error', (err) => {
          logger.error(
            { err, url: req.url },
            'Credential proxy upstream error',
          );
          if (!res.headersSent) {
            res.writeHead(502);
            res.end('Bad Gateway');
          }
        });

        upstream.write(body);
        upstream.end();
      });
    });

    server.listen(port, host, () => {
      logger.info({ port, host, authMode }, 'Credential proxy started');
      resolve(server);
    });

    server.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Proactive token refresh
// ---------------------------------------------------------------------------

/** Interval handle for the background refresh timer. */
let refreshInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Auth failure notifications
// ---------------------------------------------------------------------------

/** Callback to notify the user when OAuth auth is broken. */
let authFailureNotifier: ((message: string) => void) | null = null;
let consecutiveFailures = 0;

/**
 * Register a callback that fires when OAuth refresh fails.
 * Called once from index.ts after Slack connects.
 */
export function onAuthFailure(cb: (message: string) => void): void {
  authFailureNotifier = cb;
}

/** Check token health and refresh proactively. Runs on a timer. */
async function proactiveRefresh(): Promise<void> {
  const creds = readCredentials();
  if (!creds) return;
  const expiresIn = creds.expiresAt - Date.now();
  if (expiresIn < REFRESH_BUFFER_MS) {
    logger.info(
      { expiresInMs: expiresIn },
      'Proactive refresh: token expiring soon',
    );
    await refreshToken(creds);
  }
}

/**
 * Start a background timer that refreshes OAuth tokens before they expire,
 * even when no requests are coming in. Checks every 30 minutes.
 */
export function startProactiveRefresh(): void {
  if (refreshInterval) return;
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
  refreshInterval = setInterval(() => {
    proactiveRefresh().catch((err) =>
      logger.warn({ err }, 'Proactive refresh error'),
    );
  }, INTERVAL_MS);
  // Also run once immediately on startup after a short delay
  setTimeout(() => {
    proactiveRefresh().catch((err) =>
      logger.warn({ err }, 'Initial proactive refresh error'),
    );
  }, 5000);
}

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
