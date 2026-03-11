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
console.log('Connected to:', xero.tenants[0].tenantName);

// Get Work Wranglers contact
console.log('\nGetting Work Wranglers contact...');
const contactsResponse = await xero.accountingApi.getContacts(tenantId);
const wwContact = contactsResponse.body.contacts.find(c => c.name === 'Work Wranglers');
console.log('Contact ID:', wwContact?.contactID);

// Try to create an invoice
console.log('\nTrying to create invoice...');
const invoiceDate = new Date(2026, 1, 1);  // Feb 1, 2026
const dueDate = new Date(2026, 1, 15);

const invoice = {
  contact: { contactID: wwContact.contactID },
  lineItems: [{
    description: 'Test line item',
    quantity: 1,
    unitAmount: 100,
    taxType: 'TAX001',
    accountCode: '200'
  }],
  date: invoiceDate,
  dueDate: dueDate,
  reference: 'Test Invoice',
  status: 'DRAFT'
};

try {
  const invResponse = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [invoice]
  });
  
  console.log('Response:', JSON.stringify(invResponse.body, null, 2));
  
  if (invResponse.body.invoices && invResponse.body.invoices[0]) {
    console.log('Invoice created:', invResponse.body.invoices[0].invoiceNumber);
  } else {
    console.log('No invoice in response');
    console.log('Errors:', invResponse.body.errors);
  }
} catch (error) {
  console.error('Error:', error.message);
  if (error.response) {
    console.error('Response data:', error.response.data);
  }
}
