#!/usr/bin/env node
/**
 * One-time OAuth flow to authorize cian@cognitivetech.net for Google Calendar access.
 *
 * IMPORTANT: Run from OUTSIDE the skills directory to avoid polluting node_modules:
 *
 *   cd /tmp && node ~/nanoclaw/skills/transcript-sync/scripts/auth-ctci-calendar.mjs
 *
 * Saves token to: ~/.config/nanoclaw/credentials/services/shadow-google-token.json
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { URL } from 'url';
import { homedir } from 'os';

const CLIENT_FILE = `${homedir()}/.config/nanoclaw/credentials/services/shadow-google-oauth-client.json`;
const TOKEN_FILE = `${homedir()}/.config/nanoclaw/credentials/services/shadow-google-token.json`;

const rawClient = JSON.parse(readFileSync(CLIENT_FILE, 'utf-8'));
const client = rawClient.installed || rawClient.web || rawClient;

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];
const REDIRECT_URI = client.redirect_uris?.[0] || 'http://localhost:3000/oauth2callback';

const auth = new google.auth.OAuth2(client.client_id, client.client_secret, REDIRECT_URI);

const authUrl = auth.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
  login_hint: 'cian@cognitivetech.net',
});

console.log('\nOpen this URL in your browser and sign in as cian@cognitivetech.net:\n');
console.log(authUrl);
console.log('\nWaiting for callback on', REDIRECT_URI, '...\n');

const port = new URL(REDIRECT_URI).port || 80;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const code = url.searchParams.get('code');

  if (!code) {
    res.writeHead(400);
    res.end('No code in callback');
    return;
  }

  try {
    const { tokens } = await auth.getToken(code);
    // Save in Node.js googleapis format (access_token, not token)
    const tokenData = { ...tokens, account: 'cian@cognitivetech.net' };
    writeFileSync(TOKEN_FILE, JSON.stringify(tokenData, null, 2));

    console.log('Token saved to:', TOKEN_FILE);
    console.log('Scopes:', tokens.scope);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Calendar authorization successful! You can close this tab.</h2>');
  } catch (err) {
    console.error('Error getting token:', err.message);
    res.writeHead(500);
    res.end('Error: ' + err.message);
  }

  server.close();
});

server.listen(port);
