/**
 * Operator-only: exchange an OAuth authorization code for tokens (run on host).
 * Usage: node exchange-code.mjs <authorization_code>
 */
import https from 'https';
import { loadXeroClientConfig, writeXeroTokens } from '../../xero/lib/xero-credentials.mjs';

const code = process.argv[2];
if (!code) {
  console.error('Usage: node exchange-code.mjs <authorization_code>');
  process.exit(1);
}

const { client_id: clientId, client_secret: clientSecret } = loadXeroClientConfig();
const redirectUri = 'http://localhost:8080/callback';

const postData = new URLSearchParams({
  grant_type: 'authorization_code',
  code,
  redirect_uri: redirectUri,
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

console.log('Exchanging code for tokens...');

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

console.log('✅ Got tokens!');
console.log('Scope:', result.scope);

result.expires_at = Math.floor(Date.now() / 1000) + result.expires_in;
const path = writeXeroTokens(result);
console.log('✅ Tokens saved to', path);
