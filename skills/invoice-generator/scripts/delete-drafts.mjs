import { XeroClient } from 'xero-node';
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
