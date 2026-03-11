import https from 'https';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const clientId = 'REDACTED_XERO_CLIENT_ID';
const clientSecret = 'REDACTED_XERO_CLIENT_SECRET';
const code = 'REDACTED_XERO_AUTH_CODE';
const redirectUri = 'http://localhost:8080/callback';

const postData = new URLSearchParams({
  grant_type: 'authorization_code',
  code: code,
  redirect_uri: redirectUri,
  client_id: clientId,
  client_secret: clientSecret
}).toString();

const options = {
  hostname: 'identity.xero.com',
  path: '/connect/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }
};

console.log('Exchanging code for tokens...');

const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
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

// Save tokens
const tokensPath = '/workspace/extra/credentials/xero-tokens.json';
result.expires_at = Math.floor(Date.now() / 1000) + result.expires_in;
writeFileSync(tokensPath, JSON.stringify(result, null, 2));

console.log('✅ Tokens saved to', tokensPath);
console.log('\n🎉 Now we can upload attachments!');
