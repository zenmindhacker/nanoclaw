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
