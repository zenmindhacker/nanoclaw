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
