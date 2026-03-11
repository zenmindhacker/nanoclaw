import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import https from 'https';

const tokensPath = '/workspace/extra/credentials/xero-tokens.json';
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

const refreshToken = tokens.refresh_token;
const clientId = '748CC12001CF4C89A17B5C7FBD7D9965';
const clientSecret = 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';

console.log('Current refresh token:', refreshToken);

// Manually refresh using OAuth2 endpoint
const postData = new URLSearchParams({
  grant_type: 'refresh_token',
  refresh_token: refreshToken,
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

console.log('New tokens acquired:', Object.keys(result));

// Keep the refresh token if not returned
if (!result.refresh_token) {
  result.refresh_token = refreshToken;
}

// Save new tokens
const newTokens = {
  ...tokens,
  ...result,
  expires_at: Math.floor(Date.now() / 1000) + result.expires_in
};

writeFileSync(tokensPath, JSON.stringify(newTokens, null, 2));
console.log('Tokens saved!');
