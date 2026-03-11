/**
 * Xero API Test - Using saved tokens
 */

import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';

const CLIENT_ID = '748CC12001CF4C89A17B5C7FBD7D9965';
const CLIENT_SECRET = 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';

const xero = new XeroClient({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET
});

async function main() {
  console.log('🔑 Xero API Test (using saved tokens)\n');
  
  // Load tokens
  const tokens = JSON.parse(readFileSync('/workspace/extra/credentials/xero-tokens.json', 'utf8'));
  console.log('Loaded tokens from file');
  
  // Set tokens on the client
  await xero.setTokenSet(tokens);
  
  // Update tenants (gets the connection/tenant IDs)
  console.log('Fetching tenants...');
  await xero.updateTenants();
  
  console.log(`Found ${xero.tenants.length} tenant(s)`);
  
  if (xero.tenants.length === 0) {
    console.log('❌ No tenants found');
    process.exit(1);
  }
  
  const tenant = xero.tenants[0];
  console.log(`Using tenant: ${tenant.tenantName} (${tenant.tenantId.slice(0,8)}...)`);
  
  // Test 1: Organisation
  console.log('\n1️⃣  GET Organisation');
  try {
    const orgResponse = await xero.accountingApi.getOrganisations(tenant.tenantId);
    const org = orgResponse.body.organisations[0];
    console.log(`   ✅ ${org.name}`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

  // Test 2: Accounts
  console.log('\n2️⃣  GET Accounts');
  try {
    const accountsResponse = await xero.accountingApi.getAccounts(tenant.tenantId);
    console.log(`   ✅ ${accountsResponse.body.accounts.length} accounts`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

  // Test 3: Contacts
  console.log('\n3️⃣  GET Contacts');
  try {
    const contactsResponse = await xero.accountingApi.getContacts(tenant.tenantId);
    console.log(`   ✅ ${contactsResponse.body.contacts.length} contacts`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

  // Test 4: Invoices
  console.log('\n4️⃣  GET Invoices');
  try {
    const invoicesResponse = await xero.accountingApi.getInvoices(tenant.tenantId);
    console.log(`   ✅ ${invoicesResponse.body.invoices.length} invoices`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);