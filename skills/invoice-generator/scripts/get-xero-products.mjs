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

await xero.setTokenSet(tokens);
await xero.updateTenants();

const tenantId = xero.tenants[0].tenantId;

// Get all items/products
const response = await xero.accountingApi.getItems(tenantId);

console.log('📦 Xero Products/Items:\n');
const items = response.body.items || [];
for (const item of items) {
  const price = item.salesDetails?.unitPrice || 'N/A';
  const tax = item.salesDetails?.taxType || item.salesDetails?.taxType || 'N/A';
  const account = item.salesDetails?.accountCode || 'N/A';
  console.log(`${item.code}: ${item.name}`);
  console.log(`   Unit Price: $${price} | Tax: ${tax} | Account: ${account}`);
}
