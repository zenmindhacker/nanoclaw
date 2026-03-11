#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const CLIENT_ID = '748CC12001CF4C89A17B5C7FBD7D9965';
const CLIENT_SECRET = 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';
const REDIRECT_URI = 'http://localhost:8080/callback';
const TOKEN_FILE = '/workspace/extra/credentials/xero-tokens.json';

const SCOPES = 'openid profile email accounting.read accounting.reports.read';

const AUTH_URL = `https://login.xero.com/identity/connect/authorize?` +
  `response_type=code&` +
  `client_id=${CLIENT_ID}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `scope=${encodeURIComponent(SCOPES)}&` +
  `state=test123`;

function saveTokens(tokens) {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  console.log('\n✅ Tokens saved to', TOKEN_FILE);
}

function loadTokens() {
  if (fs.existsSync(TOKEN_FILE)) {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  }
  return null;
}

function makeRequest(method, path, accessToken, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.xero.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': CLIENT_ID,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...extraHeaders
      }
    };

    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

async function exchangeCode(code) {
  console.log('\n🔄 Exchanging code for tokens...');
  
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  });

  const response = await makeRequest('POST', '/identity/oauth/token', '', params.toString());
  
  if (response.status !== 200) {
    throw new Error(`Token exchange failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }
  
  return response.data;
}

async function getConnections(accessToken) {
  console.log('\n🔄 Getting Xero connections (tenant IDs)...');
  
  const response = await makeRequest('GET', '/api.xro/2.0/Connections', accessToken);
  
  if (response.status !== 200) {
    throw new Error(`Connections failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }
  
  if (!response.data || response.data.length === 0) {
    throw new Error('No Xero connections found');
  }
  
  console.log(`   Found ${response.data.length} connection(s)`);
  return response.data[0].tenantId;
}

async function refreshAccessToken(refreshToken) {
  console.log('\n🔄 Refreshing access token...');
  
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET
  });

  const response = await makeRequest('POST', '/identity/oauth/token', '', params.toString());
  
  if (response.status !== 200) {
    throw new Error(`Token refresh failed: ${response.status} - ${JSON.stringify(response.data)}`);
  }
  
  return response.data;
}

async function testApiEndpoints(accessToken, tenantId) {
  console.log('\n🧪 Testing API endpoints...\n');
  
  const headers = { 'xero-tenant-id': tenantId };
  
  // Test 1: Organisation
  console.log('1️⃣  GET /api.xro/2.0/Organisation');
  const org = await makeRequest('GET', '/api.xro/2.0/Organisation', accessToken, null, headers);
  if (org.status === 200 && org.data && org.data.Organisations) {
    const o = org.data.Organisations[0];
    console.log(`   ✅ ${o.Name} (${o.OrganisationType})`);
  } else {
    console.log(`   ❌ ${org.status}: ${JSON.stringify(org.data).slice(0, 200)}`);
  }
  
  // Test 2: Accounts
  console.log('\n2️⃣  GET /api.xro/2.0/Accounts');
  const accounts = await makeRequest('GET', '/api.xro/2.0/Accounts', accessToken, null, headers);
  if (accounts.status === 200 && accounts.data && accounts.data.Accounts) {
    console.log(`   ✅ ${accounts.data.Accounts.length} accounts found`);
  } else {
    console.log(`   ❌ ${accounts.status}: ${JSON.stringify(accounts.data).slice(0, 200)}`);
  }
  
  // Test 3: Profit & Loss
  console.log('\n3️⃣  GET /api.xro/2.0/Reports/ProfitAndLoss?fromDate=2025-01-01&toDate=2025-12-31');
  const pnl = await makeRequest('GET', '/api.xro/2.0/Reports/ProfitAndLoss?fromDate=2025-01-01&toDate=2025-12-31', accessToken, null, headers);
  if (pnl.status === 200 && pnl.data && pnl.data.Reports && pnl.data.Reports.length > 0) {
    console.log(`   ✅ Report retrieved`);
  } else {
    console.log(`   ❌ ${pnl.status}: ${JSON.stringify(pnl.data).slice(0, 200)}`);
  }
}

async function main() {
  console.log('🔑 Xero OAuth2 API Test Script\n');
  console.log('='.repeat(50));
  
  // Check for existing tokens
  let tokens = loadTokens();
  let tenantId = null;
  
  if (!tokens) {
    // Need to do full OAuth flow
    console.log('\n📋 Step 1: Authorization');
    console.log('='.repeat(50));
    console.log('\nOpen this URL in your browser:\n');
    console.log(AUTH_URL);
    console.log('\nAfter logging in, you\'ll be redirected to localhost:8080/callback');
    console.log('The URL will contain a "code" parameter.');
    console.log('\nPaste the authorization code below:');
    
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    
    const code = await new Promise(resolve => rl.question('\nAuthorization code: ', resolve));
    rl.close();
    
    if (!code || code.trim() === '') {
      console.log('❌ No code provided');
      process.exit(1);
    }
    
    try {
      tokens = await exchangeCode(code.trim());
      saveTokens(tokens);
    } catch (err) {
      console.error('\n❌ Error exchanging code:', err.message);
      process.exit(1);
    }
  }
  
  let accessToken = tokens.access_token;
  
  // Get tenant ID
  try {
    tenantId = await getConnections(accessToken);
    console.log(`   Using tenant: ${tenantId.slice(0, 8)}...`);
  } catch (err) {
    console.error('\n❌ Error getting connections:', err.message);
    // Try to continue anyway if we have cached tenant
  }
  
  // Test API calls
  try {
    await testApiEndpoints(accessToken, tenantId);
  } catch (err) {
    if ((err.message.includes('401') || err.message.includes('invalid access token')) && tokens.refresh_token) {
      console.log('\n🔄 Token expired, refreshing...');
      try {
        const newTokens = await refreshAccessToken(tokens.refresh_token);
        tokens = { ...tokens, ...newTokens };
        saveTokens(tokens);
        accessToken = newTokens.access_token;
        
        // Re-get connections after refresh
        tenantId = await getConnections(accessToken);
        
        await testApiEndpoints(accessToken, tenantId);
      } catch (refreshErr) {
        console.error('\n❌ Token refresh failed:', refreshErr.message);
        console.log('Run script again to start fresh OAuth flow');
        fs.unlinkSync(TOKEN_FILE);
        process.exit(1);
      }
    } else {
      console.error('\n❌ API Error:', err.message);
      process.exit(1);
    }
  }
  
  console.log('\n\n✅ All tests completed!');
}

main().catch(console.error);
