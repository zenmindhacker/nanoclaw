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

// Get all invoices and find drafts
const response = await xero.accountingApi.getInvoices(tenantId);
const allInvoices = response.body.invoices || [];

// Find INV-0121 through INV-0125
const draftsToDelete = allInvoices.filter(inv => 
  ['INV-0121', 'INV-0122', 'INV-0123', 'INV-0124', 'INV-0125'].includes(inv.invoiceNumber) && inv.status === 'DRAFT'
);

console.log(`Found ${draftsToDelete.length} draft invoices to delete:`);
for (const inv of draftsToDelete) {
  console.log(`  - ${inv.invoiceNumber}: ${inv.contact?.name} ($${inv.total})`);
}

// Delete each draft by setting status to DELETED
for (const inv of draftsToDelete) {
  try {
    // Update status to DELETED
    const updatedInvoice = {
      ...inv,
      status: 'DELETED'
    };
    
    await xero.accountingApi.updateInvoice(tenantId, inv.invoiceID, {
      invoices: [updatedInvoice]
    });
    console.log(`  ✅ Deleted: ${inv.invoiceNumber}`);
  } catch (err) {
    console.log(`  ❌ Failed to delete ${inv.invoiceNumber}: ${err.message}`);
  }
}

console.log('\nDone!');
