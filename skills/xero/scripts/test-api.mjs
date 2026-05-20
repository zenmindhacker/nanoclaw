/**
 * Xero API Test - Using saved tokens
 */

import { XeroClient } from 'xero-node';
import {
  loadXeroClientConfig,
  loadXeroTokens,
  assertXeroTokenFresh,
} from '../lib/xero-credentials.mjs';

const { client_id, client_secret } = loadXeroClientConfig();
const tokens = loadXeroTokens();
assertXeroTokenFresh(tokens);

const xero = new XeroClient({
  clientId: client_id,
  clientSecret: client_secret,
});

async function main() {
  console.log('🔑 Xero API Test (using saved tokens)\n');
  console.log('Loaded tokens from credential file');

  await xero.setTokenSet(tokens);

  console.log('Fetching tenants...');
  await xero.updateTenants();

  console.log(`Found ${xero.tenants.length} tenant(s)`);

  if (xero.tenants.length === 0) {
    console.log('❌ No tenants found');
    process.exit(1);
  }

  const tenant = xero.tenants[0];
  console.log(`Using tenant: ${tenant.tenantName} (${tenant.tenantId.slice(0, 8)}...)`);

  console.log('\n1️⃣  GET Organisation');
  try {
    const orgResponse = await xero.accountingApi.getOrganisations(tenant.tenantId);
    const org = orgResponse.body.organisations[0];
    console.log(`   ✅ ${org.name}`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

  console.log('\n2️⃣  GET Accounts');
  try {
    const accountsResponse = await xero.accountingApi.getAccounts(tenant.tenantId);
    console.log(`   ✅ ${accountsResponse.body.accounts.length} accounts`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

  console.log('\n3️⃣  GET Contacts');
  try {
    const contactsResponse = await xero.accountingApi.getContacts(tenant.tenantId);
    console.log(`   ✅ ${contactsResponse.body.contacts.length} contacts`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode || err.statusCode}: ${err.message}`);
  }

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
