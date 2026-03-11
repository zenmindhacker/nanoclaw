import { createServer } from 'http';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import https from 'https';

const clientId = '748CC12001CF4C89A17B5C7FBD7D9965';
const clientSecret = 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';

// Full scopes including accounting.attachments
const scope = [
  'openid',
  'profile', 
  'email',
  'accounting.contacts',
  'accounting.settings', 
  'accounting.transactions',
  'accounting.attachments',
  'offline_access'
].join(' ');

const redirectUri = 'http://localhost:8080/callback';
const state = 'invoice-generator-auth';

const authUrl = `https://login.xero.com/identity/connect/authorize?client_id=${clientId}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${redirectUri}&state=${state}`;

console.log('🔗 Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n');

// Simple callback server
const server = createServer((req, res) => {
  if (req.url.includes('/callback')) {
    const url = new URL(req.url, 'http://localhost:8080');
    const code = url.searchParams.get('code');
    
    if (code) {
      console.log('\n✅ Got authorization code! Exchanging for tokens...\n');
      
      // Exchange code for tokens
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

      const req2 = https.request(options, (res2) => {
        let data = '';
        res2.on('data', chunk => data += chunk);
        res2.on('end', () => {
          try {
            const tokens = JSON.parse(data);
            
            // Save tokens
            const tokensPath = '/workspace/extra/credentials/xero-tokens.json';
            tokens.expires_at = Math.floor(Date.now() / 1000) + tokens.expires_in;
            writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
            
            console.log('✅ Tokens saved!');
            console.log('Scope:', tokens.scope);
            console.log('\n🎉 You can now upload attachments!');
            
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<h1>Success!</h1><p>You can close this window and return to the terminal.</p>');
            server.close();
          } catch (e) {
            console.error('Error:', e.message);
            console.log('Response:', data);
            res.writeHead(500);
            res.end('Error: ' + e.message);
          }
        });
      });
      
      req2.on('error', (e) => {
        console.error('Request error:', e.message);
        res.writeHead(500);
        res.end('Error: ' + e.message);
      });
      
      req2.write(postData);
      req2.end();
    } else {
      res.writeHead(400);
      res.end('No code found');
    }
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8080, () => {
  console.log('👂 Waiting for callback at http://localhost:8080/callback');
});
