#!/usr/bin/env node
/**
 * One-time OAuth for hello@connectedtutors.org — Google Workspace bundle (Shadow OAuth app).
 *
 * Scopes: Gmail (read/send/label), Calendar, Drive, Docs/Sheets/Slides, Contacts, Tasks.
 * Uses shadow-google-oauth-client.json (redirect: http://localhost → port 80).
 * Run on the machine where your browser completes the callback.
 *
 *   mkdir -p ~/.config/nanoclaw/credentials/services
 *   # client file must already be at:
 *   #   ~/.config/nanoclaw/credentials/services/shadow-google-oauth-client.json
 *   sudo node skills/transcript-sync/scripts/auth-hello-ct-calendar.mjs
 *
 * Saves: ~/.config/nanoclaw/credentials/services/shadow-google-token.json
 *
 * Re-run with prompt=consent whenever you add scopes here — refresh tokens do not
 * auto-upgrade to new permissions.
 */
import http from 'http';
import https from 'https';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const ACCOUNT = 'hello@connectedtutors.org';
const CRED_DIR = join(homedir(), '.config/nanoclaw/credentials/services');
const CLIENT_FILE = join(CRED_DIR, 'shadow-google-oauth-client.json');
const TOKEN_FILE = join(CRED_DIR, 'shadow-google-token.json');

/** Connected Tutors ops — read/write where Silas needs to act, not just inspect. */
const SCOPES = [
  // Gmail
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  // Calendar (full — supersedes calendar.readonly / calendar.events)
  'https://www.googleapis.com/auth/calendar',
  // Drive (files + Docs/Sheets/Slides stored in Drive)
  'https://www.googleapis.com/auth/drive',
  // Workspace editor APIs (create/edit Docs, Sheets, Slides directly)
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  // People & task lists
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
console.log('Requested scopes:\n ', SCOPES.replace(/https:\/\/www\.googleapis\.com\/auth\//g, '').split(' ').join(', '));
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

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>Connected Tutors Google Workspace authorized. You can close this tab.</h2>');
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
    console.warn('Port 80 usually requires: sudo node …/auth-hello-ct-calendar.mjs');
  }
});

setTimeout(() => {
  console.error('Timed out after 120s');
  process.exit(1);
}, 120_000);
