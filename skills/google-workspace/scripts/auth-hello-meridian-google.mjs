#!/usr/bin/env node
/**
 * One-time OAuth for christina@meridian-institute.org — Google Workspace bundle.
 *
 * Uses google-oauth-client.json (Meridian OAuth app on Silas host).
 * Run on the machine where your browser completes the callback.
 *
 *   mkdir -p ~/.config/nanoclaw/credentials/services
 *   # client file must already be at:
 *   #   ~/.config/nanoclaw/credentials/services/google-oauth-client.json
 *   node skills/google-workspace/scripts/auth-hello-meridian-google.mjs
 *
 * Saves: ~/.config/nanoclaw/credentials/services/meridian-google-token.json
 *
 * After save, add meridian-google to oauth-registry.json (see add-google-workspace-host skill).
 */
import http from 'http';
import https from 'https';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ACCOUNT = 'christina@meridian-institute.org';
const CRED_DIR = join(homedir(), '.config/nanoclaw/credentials/services');
const CLIENT_FILE = join(CRED_DIR, 'google-oauth-client.json');
const TOKEN_FILE = join(CRED_DIR, 'meridian-google-token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/tasks',
].join(' ');

const clientJson = JSON.parse(readFileSync(CLIENT_FILE, 'utf8'));
const client = clientJson.installed ?? clientJson.web ?? clientJson;
const REDIRECT_URI = client.redirect_uris?.[0] ?? 'http://localhost';
const PORT = Number(new URL(REDIRECT_URI).port || 80);

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    login_hint: ACCOUNT,
  }).toString();

console.log(`\nSign in as ${ACCOUNT} and approve Google Workspace access.`);
console.log('\nOpen this URL in your browser:\n');
console.log(authUrl);
console.log(`\nWaiting for callback on ${REDIRECT_URI} (port ${PORT}) …\n`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400);
    res.end('No authorization code in callback');
    return;
  }

  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }).toString();

  const tokenReq = https.request(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (tokenRes) => {
      let data = '';
      tokenRes.on('data', (chunk) => {
        data += chunk;
      });
      tokenRes.on('end', () => {
        const tokens = JSON.parse(data);
        if (tokens.error) {
          console.error('Token error:', tokens);
          res.writeHead(500);
          res.end(`Error: ${tokens.error_description ?? tokens.error}`);
          server.close();
          process.exit(1);
          return;
        }

        tokens.expires_at = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);
        tokens.account = ACCOUNT;
        writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));

        console.log('Token saved to:', TOKEN_FILE);
        console.log('Scope:', tokens.scope);
        console.log('Has refresh token:', Boolean(tokens.refresh_token));
        console.log('\nNext: add meridian-google to oauth-registry.json and run:');
        console.log('  ncl oauth-refresh-one --id meridian-google');

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Meridian Google Workspace authorized. You can close this tab.</h2>');
        server.close();
        process.exit(0);
      });
    },
  );
  tokenReq.on('error', (err) => {
    console.error(err);
    res.writeHead(500);
    res.end(String(err));
  });
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(PORT, () => {
  if (PORT === 80 && process.getuid?.() !== 0) {
    console.warn('Port 80 usually requires: sudo node …/auth-hello-meridian-google.mjs');
  }
});

setTimeout(() => {
  console.error('Timed out after 120s');
  process.exit(1);
}, 120_000);
