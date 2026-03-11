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
/** Refresh proactively when less than this many ms remain. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Keychain service/account used by Claude Code ≥ 2.1 on macOS. */
const KC_SERVICE = 'Claude Code-credentials';
const KC_ACCOUNT = os.userInfo().username;
/** Fallback file path used by older Claude Code versions. */
const CRED_FILE = path.join(os.homedir(), '.claude', '.credentials.json');

interface OAuthCreds {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function execSync(cmd: string): string {
  const { execSync: exec } = require('child_process') as typeof import('child_process');
  return exec(cmd, { encoding: 'utf-8' }).trim();
}

function readCredentials(): OAuthCreds | null {
  // Try macOS Keychain first (Claude Code ≥ 2.1)
  try {
    const raw = execSync(
      `security find-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)} -w`,
    );
    const o = JSON.parse(raw)?.claudeAiOauth;
    if (o?.accessToken && o?.refreshToken && o?.expiresAt) return o as OAuthCreds;
  } catch { /* fall through */ }

  // Fallback: flat file (Claude Code < 2.1)
  try {
    const data = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8'));
    const o = data?.claudeAiOauth;
    if (o?.accessToken && o?.refreshToken && o?.expiresAt) return o as OAuthCreds;
  } catch { /* ignore */ }

  return null;
}

function writeCredentials(creds: OAuthCreds): void {
  // Try Keychain first
  try {
    let existing: Record<string, unknown> = {};
    try {
      const raw = execSync(
        `security find-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)} -w`,
      );
      existing = JSON.parse(raw);
    } catch { /* ok — may not exist yet */ }

    existing.claudeAiOauth = { ...(existing.claudeAiOauth as object || {}), ...creds };
    const json = JSON.stringify(existing);
    // delete then add — `add-generic-password` fails if item exists
    try {
      execSync(`security delete-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)}`);
    } catch { /* not found — that's fine */ }
    execSync(
      `security add-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)} -w ${JSON.stringify(json)}`,
    );
    logger.info('Refreshed credentials written to Keychain');
    return;
  } catch (err) {
    logger.warn({ err }, 'Keychain write failed, falling back to file');
  }

  // Fallback: write to file
  try {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8')); } catch { /* ok */ }
    data.claudeAiOauth = { ...(data.claudeAiOauth as object || {}), ...creds };
    fs.writeFileSync(CRED_FILE, JSON.stringify(data, null, 2));
    logger.info('Refreshed credentials written to file');
  } catch (err) {
    logger.warn({ err }, 'Failed to write refreshed credentials');
  }
}

function fetchJson(url: string, body: string): Promise<Record<string, unknown>> {
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
        res.on('data', (c: Buffer) => { raw += c.toString(); });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { reject(new Error(`Non-JSON response: ${raw.slice(0, 200)}`)); }
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
        return null;
      }
      const next: OAuthCreds = {
        accessToken: json.access_token as string,
        refreshToken: (json.refresh_token as string) || creds.refreshToken,
        expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      };
      writeCredentials(next);
      logger.info('OAuth token refreshed successfully');
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
    return null;
  }
  const expiresIn = creds.expiresAt - Date.now();
  if (expiresIn < REFRESH_BUFFER_MS) {
    logger.info({ expiresInMs: expiresIn }, 'OAuth token expiring soon, refreshing...');
    const refreshed = await refreshToken(creds);
    return refreshed ?? creds.accessToken; // fall back to existing if refresh fails
  }
  return creds.accessToken;
}

export type AuthMode = 'api-key' | 'oauth';

export interface ProxyConfig {
  authMode: AuthMode;
}

export function startCredentialProxy(
  port: number,
  host = '127.0.0.1',
): Promise<Server> {
  const secrets = readEnvFile([
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
  ]);

  const authMode: AuthMode = secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';

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
            const oauthToken = await getOAuthToken();
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

/** Detect which auth mode the host is configured for. */
export function detectAuthMode(): AuthMode {
  const secrets = readEnvFile(['ANTHROPIC_API_KEY']);
  return secrets.ANTHROPIC_API_KEY ? 'api-key' : 'oauth';
}
