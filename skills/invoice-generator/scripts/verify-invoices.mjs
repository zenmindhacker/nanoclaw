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

// Get all invoices
const response = await xero.accountingApi.getInvoices(tenantId);
const allInvoices = response.body.invoices || [];

// Find our new invoices
const newInvoices = allInvoices
  .filter(inv => ['INV-0131', 'INV-0132', 'INV-0133', 'INV-0134', 'INV-0135'].includes(inv.invoiceNumber))
  .sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));

console.log('📋 FINAL Generated Draft Invoices:\n');

for (const inv of newInvoices) {
  console.log(`${inv.invoiceNumber} - ${inv.contact?.name}`);
  console.log(`   Status: ${inv.status}`);
  console.log(`   Total: $${inv.total || 0}`);
  console.log('');
}
