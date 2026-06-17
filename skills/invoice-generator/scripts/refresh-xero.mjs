/**
 * Operator-only: manual token refresh on the host (prefer host OAuth refresher in production).
 */
import https from 'https';
import {
  loadXeroClientConfig,
  loadXeroTokens,
  writeXeroTokens,
} from '../../xero/lib/xero-credentials.mjs';

const tokens = loadXeroTokens();
const refreshToken = tokens.refresh_token;
const { client_id: clientId, client_secret: clientSecret } = loadXeroClientConfig();

console.log('Refreshing Xero access token (operator script)...');

const postData = new URLSearchParams({
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
  client_id: clientId,
  client_secret: clientSecret,
}).toString();

const options = {
  hostname: 'identity.xero.com',
  path: '/connect/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  },
};

const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(JSON.parse(data));
      } else {
        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      }
    });
  });
  req.on('error', reject);
  req.write(postData);
  req.end();
});

if (!result.refresh_token) {
  result.refresh_token = refreshToken;
}

const newTokens = {
  ...tokens,
  ...result,
  expires_at: Math.floor(Date.now() / 1000) + result.expires_in,
};

const path = writeXeroTokens(newTokens);
console.log('Tokens saved to', path);
