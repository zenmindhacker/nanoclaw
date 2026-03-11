import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

// Try to manually construct a request using the SDK's internal mechanism
const xero = new XeroClient({
  clientId: '748CC12001CF4C89A17B5C7FBD7D9965',
  clientSecret: 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh'
});

const tokensPath = '/workspace/extra/credentials/xero-tokens.json';
const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));

await xero.setTokenSet(tokens);
await xero.updateTenants();

const tenantId = xero.tenants[0].tenantId;

// Get invoice first
const response = await xero.accountingApi.getInvoices(tenantId);
const invoice = response.body.invoices.find(inv => inv.invoiceNumber === 'INV-0131');
console.log('Invoice ID:', invoice.invoiceID);

// Try using the SDK's basePath and making a custom request
console.log('SDK basePath:', xero.accountingApi.basePath);

// Try with the SDK's internal axios if available
const pdfPath = '/tmp/toggl-test-report.pdf';
const pdfData = readFileSync(pdfPath);
const filename = `Toggl-Report-${invoice.invoiceNumber}.pdf`;

// Use the SDK's own axios instance if it has one
const apiClient = xero.accountingApi;

console.log('Trying manual request via SDK...');

// Check if there's an accessToken property
console.log('API client accessToken:', apiClient.accessToken);

try {
  // Try using the SDK's own request method
  // Look for a way to make raw requests
  const result = await apiClient.createInvoiceAttachmentByFileName(
    tenantId,
    invoice.invoiceID,
    filename,
    pdfData,
    { IncludeOnline: true }
  );
  console.log('Success:', result);
} catch (err) {
  console.error('Error:', err);
  console.error('Error keys:', Object.keys(err));
  console.error('Error response:', err.response?.data);
}
