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
