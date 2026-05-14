#!/usr/bin/env node
/**
 * One-time OAuth flow to authorize cian@ganttsy.com for Google Drive + Docs access.
 *
 * IMPORTANT: Run from OUTSIDE the skills directory to avoid polluting node_modules
 * with macOS binaries (the container needs Linux binaries):
 *
 *   cd /tmp && node ~/nanoclaw/skills/transcript-sync/scripts/auth-ganttsy-drive.mjs
 *
 * Or ensure googleapis is installed globally first: npm install -g googleapis
 *
 * Saves token to: ~/.config/nanoclaw/credentials/services/ganttsy-google-token.json
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { URL } from 'url';
import { homedir } from 'os';

const CLIENT_FILE = `${homedir()}/.config/nanoclaw/credentials/services/ganttsy-google-oauth-client.json`;
const TOKEN_FILE = `${homedir()}/.config/nanoclaw/credentials/services/ganttsy-google-token.json`;

const rawClient = JSON.parse(readFileSync(CLIENT_FILE, 'utf-8'));
const client = rawClient.installed || rawClient.web || rawClient;

const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
];

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const auth = new google.auth.OAuth2(client.client_id, client.client_secret, REDIRECT_URI);

const authUrl = auth.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // force refresh_token to be returned
  login_hint: 'cian@ganttsy.com',
});

console.log('\nOpen this URL in your browser and sign in as cian@ganttsy.com:\n');
console.log(authUrl);
console.log('\nWaiting for callback on http://localhost:3000/oauth2callback ...\n');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code in callback');
    return;
  }

  try {
    const { tokens } = await auth.getToken(code);
    auth.setCredentials(tokens);

    // Save token (preserve email field for reference)
    const tokenData = { ...tokens, email: 'cian@ganttsy.com' };
    writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    console.log('Token saved to:', TOKEN_FILE);
    console.log('Scopes:', tokens.scope);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Authorization successful! You can close this tab.</h2>');
  } catch (err) {
    console.error('Error getting token:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
  }

  server.close();
});

server.listen(3000);
