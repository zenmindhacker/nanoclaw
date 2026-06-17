import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

import {
  loadXeroClientConfig,
  loadXeroTokens,
  assertXeroTokenFresh,
} from '../../xero/lib/xero-credentials.mjs';

const { client_id, client_secret } = loadXeroClientConfig();
const tokens = loadXeroTokens();
assertXeroTokenFresh(tokens);

const xero = new XeroClient({ clientId: client_id, clientSecret: client_secret });

console.log('Tokens file keys:', Object.keys(tokens));
console.log('Access token:', tokens.access_token ? 'OK' : 'MISSING');
console.log('Refresh token:', tokens.refresh_token ? 'OK' : 'MISSING');

await xero.setTokenSet(tokens);
await xero.updateTenants();

console.log('TokenSet keys:', Object.keys(xero.tokenSet));
console.log('Access token in SDK:', xero.tokenSet.access_token ? 'OK' : 'MISSING');
