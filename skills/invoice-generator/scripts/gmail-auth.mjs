import http from 'http';
import https from 'https';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const clientJson = JSON.parse(readFileSync(resolve(homedir(), '.config/nanoclaw/credentials/services/shadow-google-oauth-client.json'), 'utf8'));
const client = clientJson.installed;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly'
].join(' ');

const PORT = 9879;
const REDIRECT_URI = `http://localhost:${PORT}`;

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPES,
  access_type: 'offline',
  prompt: 'consent',
  login_hint: 'cian@cognitivetech.net'
}).toString();

console.log('Opening browser for CTCI Google authorization (Gmail + Calendar + Drive)...');
execSync(`open "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const code = url.searchParams.get('code');
  if (!code) { res.end('No code'); return; }

  const body = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code'
  }).toString();

  const tokenReq = https.request({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, (tokenRes) => {
    let data = '';
    tokenRes.on('data', c => data += c);
    tokenRes.on('end', () => {
      const tokens = JSON.parse(data);
      tokens.expires_at = Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600);
      tokens.account = 'cian@cognitivetech.net';

      const savePath = resolve(homedir(), '.config/nanoclaw/credentials/services/google-gmail-token.json');
      writeFileSync(savePath, JSON.stringify(tokens, null, 2));
      console.log('Tokens saved to', savePath);
      console.log('Scope:', tokens.scope);
      console.log('Has refresh:', !!tokens.refresh_token);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h2>CTCI Google authorized (Gmail + Calendar + Drive)! You can close this tab.</h2>');
      server.close();
      process.exit(0);
    });
  });
  tokenReq.write(body);
  tokenReq.end();
});

server.listen(PORT, () => console.log(`Waiting for callback on port ${PORT}...`));
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 120000);
