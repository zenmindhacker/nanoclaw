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

// Try without 'where' parameter
console.log('\nTrying to get contacts WITHOUT where param...');
try {
  const contactsResponse = await xero.accountingApi.getContacts(tenantId);
  console.log('Contacts found:', contactsResponse.body.contacts?.length || 0);
  
  // Find Work Wranglers manually
  const ww = contactsResponse.body.contacts?.find(c => c.name === 'Work Wranglers');
  if (ww) {
    console.log('Found Work Wranglers:', ww.contactID);
  }
} catch (error) {
  console.error('Error:', error.message);
}
