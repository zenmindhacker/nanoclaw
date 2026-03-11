/**
 * Xero API Test Script using xero-node SDK
 * 
 * Run: node xero-test.mjs
 * 
 * Flow:
 * 1. Generates authorization URL
 * 2. User visits and authorizes
 * 3. Pastes the code from redirect
 * 4. Script exchanges code for tokens and saves to credentials file
 * 5. Tests API endpoints
 */

import { XeroClient } from 'xero-node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const CLIENT_ID = '748CC12001CF4C89A17B5C7FBD7D9965';
const CLIENT_SECRET = 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';
const REDIRECT_URI = 'http://localhost:8080/callback';
const CREDENTIALS_DIR = join(__dirname, '..', 'credentials');
const TOKEN_FILE = join(CREDENTIALS_DIR, 'xero-tokens.json');

const SCOPES = [
  'openid',
  'profile', 
  'email',
  'accounting.transactions',
  'accounting.settings',
  'accounting.contacts',
  'offline_access'
];

// Initialize Xero client
const xero = new XeroClient({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  redirectUris: [REDIRECT_URI],
  scopes: SCOPES,
  state: 'test-xero-api'
});

function saveTokens(tokens) {
  try {
    writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    console.log('\n✅ Tokens saved to', TOKEN_FILE);
  } catch (err) {
    console.error('Error saving tokens:', err.message);
  }
}

function loadTokens() {
  if (existsSync(TOKEN_FILE)) {
    return JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  }
  return null;
}

async function testApiEndpoints() {
  console.log('\n🧪 Testing API endpoints...\n');

  // Test 1: Organisation
  console.log('1️⃣  GET /api.xro/2.0/Organisation');
  try {
    const orgResponse = await xero.accountingApi.getOrganisations('');
    const org = orgResponse.body.organisations[0];
    console.log(`   ✅ ${org.name} (${org.organisationType})`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode}: ${err.message}`);
  }

  // Test 2: Accounts
  console.log('\n2️⃣  GET /api.xro/2.0/Accounts');
  try {
    const accountsResponse = await xero.accountingApi.getAccounts('');
    const accounts = accountsResponse.body.accounts;
    console.log(`   ✅ ${accounts.length} accounts found`);
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode}: ${err.message}`);
  }

  // Test 3: Profit & Loss Report
  console.log('\n3️⃣  GET /api.xro/2.0/Reports/ProfitAndLoss');
  try {
    const pnlResponse = await xero.accountingApi.getReportProfitAndLoss(
      '',
      '2025-01-01',
      '2025-12-31'
    );
    const reports = pnlResponse.body.reports;
    if (reports && reports.length > 0) {
      console.log(`   ✅ Report retrieved`);
    } else {
      console.log(`   ⚠️  No report data`);
    }
  } catch (err) {
    console.log(`   ❌ ${err.response?.statusCode}: ${err.message}`);
  }
}

async function main() {
  console.log('🔑 Xero API Test (xero-node SDK)\n');
  console.log('='.repeat(50));

  // Check for existing tokens
  let tokens = loadTokens();

  if (!tokens) {
    // Step 1: Generate authorization URL
    console.log('\n📋 Step 1: Authorization');
    console.log('='.repeat(50));

    const consentUrl = await xero.buildConsentUrl();
    console.log('\nOpen this URL in your browser:\n');
    console.log(consentUrl);
    console.log('\nAfter authorizing, you\'ll be redirected to:');
    console.log(REDIRECT_URI);
    console.log('\nThe URL will contain a "code" parameter.');
    console.log('\nPaste the authorization code below:');

    const readline = await import('readline');
    const rl = readline.default.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const code = await new Promise(resolve => 
      rl.question('\nAuthorization code: ', resolve)
    );
    rl.close();

    if (!code || code.trim() === '') {
      console.log('❌ No code provided');
      process.exit(1);
    }

    // Step 2: Exchange code for tokens
    console.log('\n📋 Step 2: Exchanging code for tokens...');
    try {
      const tokenSet = await xero.apiCallback(code.trim());
      tokens = tokenSet;
      saveTokens(tokens);
      console.log('✅ Tokens received and saved');
    } catch (err) {
      console.error('\n❌ Error exchanging code:', err.message);
      process.exit(1);
    }
  } else {
    console.log('\n📋 Using existing tokens from', TOKEN_FILE);
  }

  // Set tokens on Xero client
  await xero.updateTenants();

  // Check if token needs refresh
  const isTokenExpired = xero.isTokenExpired();
  if (isTokenExpired && tokens.refresh_token) {
    console.log('\n🔄 Token expired, refreshing...');
    try {
      const newTokens = await xero.refreshToken();
      tokens = newTokens;
      saveTokens(tokens);
      await xero.updateTenants();
    } catch (err) {
      console.error('❌ Token refresh failed:', err.message);
      console.log('Run script again to start fresh OAuth flow');
      process.exit(1);
    }
  }

  // Test API endpoints
  await testApiEndpoints();

  console.log('\n\n✅ All tests completed!');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});