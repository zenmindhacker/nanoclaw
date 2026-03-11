/**
 * test-token-refresh.mjs
 * Manually triggers an OAuth token refresh and reports the result.
 * Run with: node scripts/test-token-refresh.mjs
 */
import { execSync } from 'child_process';
import { createRequire } from 'module';
import https from 'https';
import os from 'os';

const KC_SERVICE = 'Claude Code-credentials';
const KC_ACCOUNT = os.userInfo().username;
const CLIENT_ID  = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_URL  = 'https://platform.claude.com/v1/oauth/token';

function readCreds() {
  const raw = execSync(
    `security find-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)} -w`,
    { encoding: 'utf-8' },
  ).trim();
  return JSON.parse(raw)?.claudeAiOauth;
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const before = readCreds();
console.log('Before:');
console.log('  expiresAt:', new Date(before.expiresAt).toISOString());
console.log('  expiresInMin:', Math.round((before.expiresAt - Date.now()) / 60000));
console.log('  accessToken:', before.accessToken.slice(0, 24) + '...');

console.log('\nCalling refresh endpoint...');
const body = new URLSearchParams({
  grant_type: 'refresh_token',
  refresh_token: before.refreshToken,
  client_id: CLIENT_ID,
}).toString();

const { status, body: json } = await post(TOKEN_URL, body);
console.log('HTTP status:', status);

if (json.error) {
  console.error('Refresh FAILED:', json.error, json.error_description || '');
  process.exit(1);
}

console.log('\nRefresh succeeded!');
const newExpiry = Date.now() + (Number(json.expires_in) || 3600) * 1000;
console.log('  new accessToken:', json.access_token.slice(0, 24) + '...');
console.log('  new expiresAt:', new Date(newExpiry).toISOString());
console.log('  new expiresInMin:', Math.round((newExpiry - Date.now()) / 60000));

// Write back to keychain
const existing = JSON.parse(
  execSync(`security find-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)} -w`, { encoding: 'utf-8' }).trim()
);
existing.claudeAiOauth = {
  ...existing.claudeAiOauth,
  accessToken: json.access_token,
  refreshToken: json.refresh_token || before.refreshToken,
  expiresAt: newExpiry,
};
try {
  execSync(`security delete-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)}`);
} catch { /* ok */ }
execSync(
  `security add-generic-password -s ${JSON.stringify(KC_SERVICE)} -a ${JSON.stringify(KC_ACCOUNT)} -w ${JSON.stringify(JSON.stringify(existing))}`,
);

const after = readCreds();
console.log('\nKeychain verified:');
console.log('  accessToken:', after.accessToken.slice(0, 24) + '...');
console.log('  expiresAt:', new Date(after.expiresAt).toISOString());
console.log('\n✓ Token refresh working correctly');
