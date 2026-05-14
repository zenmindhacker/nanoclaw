import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const xero = new XeroClient({
  clientId: 'REDACTED_XERO_CLIENT_ID',
  clientSecret: 'REDACTED_XERO_CLIENT_SECRET'
});

const tokensPath = '/workspace/extra/credentials/xero-tokens.json';
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

console.log('Tokens file keys:', Object.keys(tokens));
console.log('Access token:', tokens.access_token ? 'OK' : 'MISSING');
console.log('Refresh token:', tokens.refresh_token ? 'OK' : 'MISSING');

await xero.setTokenSet(tokens);
await xero.updateTenants();

console.log('TokenSet keys:', Object.keys(xero.tokenSet));
console.log('Access token in SDK:', xero.tokenSet.access_token ? 'OK' : 'MISSING');
