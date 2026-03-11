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
