import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const xero = new XeroClient({
  clientId: '748CC12001CF4C89A17B5C7FBD7D9965',
  clientSecret: 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh'
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
