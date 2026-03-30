/**
 * OAuth callback server for browser-based re-auth flows.
 *
 * When refresh tokens get revoked, this server handles the full OAuth dance
 * via a public endpoint at cleo.cognitivetech.net (behind Cloudflare).
 *
 * Routes:
 *   GET /auth/:provider  — Redirects to provider's authorization URL
 *   GET /auth/callback    — Receives code, exchanges for tokens, saves them
 *   GET /health           — Returns 200 OK
 */
import { createServer, Server } from 'http';
import { request as httpsRequest } from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { logger } from './logger.js';

const CRED_DIR = path.join(
  os.homedir(),
  '.config',
  'nanoclaw',
  'credentials',
  'services',
);
const REGISTRY_PATH = path.join(CRED_DIR, 'oauth-registry.json');
const REDIRECT_URI = 'https://cleo.cognitivetech.net/auth/callback';

interface RegistryEntry {
  id: string;
  token_file: string;
  provider: string;
  token_url: string;
  client_file: string;
  auth_method: 'post_body' | 'basic_auth';
  account: string;
  org: string;
}

interface OAuthRegistry {
  version: number;
  tokens: RegistryEntry[];
}

function loadRegistry(): OAuthRegistry | null {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function loadClientCredentials(
  filename: string,
): { client_id: string; client_secret: string } | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(CRED_DIR, filename), 'utf-8'),
    );
    const creds = raw.installed || raw.web || raw;
    if (creds.client_id && creds.client_secret) return creds;
    return null;
  } catch {
    return null;
  }
}

function saveTokenFile(filename: string, token: Record<string, unknown>): void {
  const filePath = path.join(CRED_DIR, filename);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(token, null, 2));
  fs.renameSync(tmpPath, filePath);
}

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

function findEntry(id: string): RegistryEntry | null {
  const registry = loadRegistry();
  return registry?.tokens.find((e) => e.id === id) ?? null;
}

function buildAuthUrl(entry: RegistryEntry, clientId: string): string {
  if (entry.provider === 'google') {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope:
        (loadTokenFileRaw(entry.token_file)?.scope as string) || 'openid email',
      access_type: 'offline',
      prompt: 'consent',
      state: entry.id,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  // Xero
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope:
      'openid profile email accounting.transactions accounting.contacts offline_access',
    state: entry.id,
  });
  return `https://login.xero.com/identity/connect/authorize?${params}`;
}

function loadTokenFileRaw(filename: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CRED_DIR, filename), 'utf-8'));
  } catch {
    return null;
  }
}

let server: Server | null = null;
let alertCallback: ((msg: string) => void) | null = null;

export function startOAuthCallbackServer(
  port: number,
  opts?: { onAlert?: (msg: string) => void },
): Promise<Server> {
  alertCallback = opts?.onAlert ?? null;

  return new Promise((resolve, reject) => {
    const s = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"ok"}');
        return;
      }

      // Start OAuth flow
      const startMatch = url.pathname.match(/^\/auth\/([^/]+)$/);
      if (startMatch && startMatch[1] !== 'callback') {
        const entryId = startMatch[1];
        const entry = findEntry(entryId);
        if (!entry) {
          res.writeHead(404);
          res.end(`Unknown provider entry: ${entryId}`);
          return;
        }
        const creds = loadClientCredentials(entry.client_file);
        if (!creds) {
          res.writeHead(500);
          res.end('Client credentials not found');
          return;
        }
        const authUrl = buildAuthUrl(entry, creds.client_id);
        res.writeHead(302, { location: authUrl });
        res.end();
        logger.info(
          { id: entryId },
          'OAuth flow started, redirecting to provider',
        );
        return;
      }

      // OAuth callback
      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state) {
          res.writeHead(400);
          res.end('Missing code or state parameter');
          return;
        }
        const entry = findEntry(state);
        if (!entry) {
          res.writeHead(400);
          res.end(`Unknown state: ${state}`);
          return;
        }
        const creds = loadClientCredentials(entry.client_file);
        if (!creds) {
          res.writeHead(500);
          res.end('Client credentials not found');
          return;
        }

        try {
          const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: creds.client_id,
            client_secret: creds.client_secret,
          }).toString();

          const json = await postForm(entry.token_url, body, {});
          if (json.error) {
            logger.error(
              { id: entry.id, error: json.error },
              'Token exchange failed',
            );
            res.writeHead(500, { 'content-type': 'text/html' });
            res.end(
              `<h1>Auth failed</h1><p>${json.error_description || json.error}</p>`,
            );
            return;
          }

          // Build token file, preserving existing metadata
          const existing = loadTokenFileRaw(entry.token_file) || {};
          const nowSec = Math.floor(Date.now() / 1000);
          const expiresIn = Number(json.expires_in) || 3600;
          const token: Record<string, unknown> = {
            ...existing,
            access_token: json.access_token,
            refresh_token: json.refresh_token || existing.refresh_token,
            expires_at: nowSec + expiresIn,
            expires_in: expiresIn,
          };
          if (entry.provider === 'google') {
            token.expiry_date = (nowSec + expiresIn) * 1000;
          }
          if (json.id_token) token.id_token = json.id_token;
          if (json.scope) token.scope = json.scope;

          saveTokenFile(entry.token_file, token);
          logger.info(
            { id: entry.id, account: entry.account },
            'OAuth re-auth complete',
          );

          const msg = `OAuth re-auth complete for *${entry.id}* (${entry.account})`;
          if (alertCallback) {
            try {
              alertCallback(msg);
            } catch {
              /* best-effort */
            }
          }

          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(
            '<html><body><h1>Auth complete</h1><p>You can close this tab.</p></body></html>',
          );
        } catch (err) {
          logger.error({ id: entry.id, err }, 'Token exchange error');
          res.writeHead(500, { 'content-type': 'text/html' });
          res.end(
            '<h1>Auth error</h1><p>Token exchange failed. Check server logs.</p>',
          );
        }
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    s.listen(port, '0.0.0.0', () => {
      logger.info({ port }, 'OAuth callback server started');
      server = s;
      resolve(s);
    });

    s.on('error', reject);
  });
}

export function stopOAuthCallbackServer(): void {
  if (server) {
    server.close();
    server = null;
    logger.info('OAuth callback server stopped');
  }
}
