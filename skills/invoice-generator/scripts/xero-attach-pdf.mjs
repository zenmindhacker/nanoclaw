import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';
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

// Find INV-0131
const response = await xero.accountingApi.getInvoices(tenantId);
const allInvoices = response.body.invoices || [];
const invoice = allInvoices.find(inv => inv.invoiceNumber === 'INV-0131');

if (!invoice) {
  console.log('Invoice not found');
  process.exit(1);
}

console.log('Found invoice:', invoice.invoiceNumber, invoice.invoiceID);

// Read the PDF file
const pdfPath = '/tmp/toggl-test-report.pdf';
const pdfData = readFileSync(pdfPath);
const filename = `Toggl-Report-${invoice.invoiceNumber}.pdf`;

// Try to upload using the SDK method
console.log('Trying to upload attachment...');

try {
  // The SDK has createInvoiceAttachmentByFileName
  const result = await xero.accountingApi.createInvoiceAttachmentByFileName(
    tenantId,
    invoice.invoiceID,
    filename,
    pdfData,
    {
      IncludeOnline: true
    }
  );
  
  console.log('Upload success!');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
}
