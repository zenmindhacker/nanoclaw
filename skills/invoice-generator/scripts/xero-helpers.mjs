/**
 * Xero API Helpers
 * Handles OAuth2 tokens, invoice creation, and contact management
 */

import { XeroClient } from 'xero-node';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import https from 'https';

const DEFAULT_CONFIG = {
  client_id: '748CC12001CF4C89A17B5C7FBD7D9965',
  client_secret: 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh',
  tokens_file: '~/.openclaw/credentials/xero-tokens.json'
};

let xeroClient = null;
let currentTenantId = null;

/**
 * Refresh Xero token directly via HTTP (avoids xero-node OAuth config requirements)
 */
function refreshXeroToken(clientId, clientSecret, refreshToken) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'identity.xero.com',
      path: '/connect/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(`Token refresh failed: ${parsed.error} - ${parsed.error_description}`));
          // Add expires_at for easy comparison later
          parsed.expires_at = Math.floor(Date.now() / 1000) + (parsed.expires_in || 1800);
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Initialize Xero client and authenticate
 */
export async function initXero() {
  const config = DEFAULT_CONFIG;
  
  xeroClient = new XeroClient({
    clientId: config.client_id,
    clientSecret: config.client_secret
  });
  
  // Load and set tokens
  const tokensPath = resolve(homedir(), '.openclaw/credentials/xero-tokens.json');
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
  
  // Refresh access token if expired (before setting on client)
  const now = Date.now() / 1000;
  if (tokens.expires_at && tokens.expires_at < now) {
    console.log('🔄 Xero access token expired, refreshing...');
    const refreshed = await refreshXeroToken(config.client_id, config.client_secret, tokens.refresh_token);
    Object.assign(tokens, refreshed);
    const tokensPathForSave = resolve(homedir(), '.openclaw/credentials/xero-tokens.json');
    writeFileSync(tokensPathForSave, JSON.stringify(tokens, null, 2));
    console.log('✅ Token refreshed and saved');
  }

  await xeroClient.setTokenSet(tokens);

  // Update tenants (connection)
  await xeroClient.updateTenants();

  if (xeroClient.tenants.length === 0) {
    throw new Error('No Xero tenants found');
  }

  currentTenantId = xeroClient.tenants[0].tenantId;

  console.log(`✅ Xero connected: ${xeroClient.tenants[0].tenantName}`);
  
  return { client: xeroClient, tenantId: currentTenantId };
}

/**
 * Save refreshed tokens
 */
async function saveTokens() {
  const tokenSet = xeroClient.tokenSet;
  const tokensPath = resolve(homedir(), '.openclaw/credentials/xero-tokens.json');
  writeFileSync(tokensPath, JSON.stringify(tokenSet, null, 2));
}

/**
 * Ensure we have valid tokens - reuse existing client if already initialized
 */
export async function ensureValidToken() {
  // If we already have a client, just return it (no reconnection)
  if (xeroClient && currentTenantId) {
    return { client: xeroClient, tenantId: currentTenantId };
  }
  
  // Otherwise initialize
  await initXero();
  return { client: xeroClient, tenantId: currentTenantId };
}

/**
 * Get or create a contact in Xero
 */
export async function getOrCreateContact(contactName) {
  const { client, tenantId } = await ensureValidToken();
  
  // Get all contacts and find manually (workaround for xero-node where clause bug)
  const response = await client.accountingApi.getContacts(tenantId);
  
  const contacts = response.body.contacts || [];
  const existingContact = contacts.find(c => c.name === contactName);
  
  if (existingContact) {
    return existingContact;
  }
  
  // Create new contact
  const newContact = {
    name: contactName
  };
  
  const createResponse = await client.accountingApi.createContacts(tenantId, {
    contacts: [newContact]
  });
  
  return createResponse.body.contacts[0];
}

/**
 * Find existing draft invoices for a contact and delete them
 * @param {string} tenantId - Xero tenant ID
 * @param {string} contactName - Contact name to search for
 */
export async function deleteExistingDraftInvoices(contactName) {
  const { client, tenantId } = await ensureValidToken();
  
  // Get all invoices and filter manually (workaround for xero-node where clause bug)
  const response = await client.accountingApi.getInvoices(tenantId);
  
  const allInvoices = response.body.invoices || [];
  const drafts = allInvoices.filter(inv => 
    inv.contact?.name === contactName && inv.status === 'DRAFT'
  );
  
  if (drafts.length > 0) {
    console.log(`   🗑️  Found ${drafts.length} existing draft(s) for ${contactName}`);
    
    for (const invoice of drafts) {
      try {
        // Update status to DELETED
        const updatedInvoice = {
          ...invoice,
          status: 'DELETED'
        };
        
        await client.accountingApi.updateInvoice(tenantId, invoice.invoiceID, {
          invoices: [updatedInvoice]
        });
        console.log(`   ✅ Deleted draft: ${invoice.invoiceNumber}`);
      } catch (err) {
        console.log(`   ⚠️ Could not delete ${invoice.invoiceNumber}: ${err.message}`);
      }
    }
  }
  
  return drafts.length;
}

/**
 * Get prior month invoices for a contact (for copying)
 */
export async function getPriorMonthInvoice(contactName, month, year) {
  const { client, tenantId } = await ensureValidToken();
  
  // Calculate prior month
  let priorMonth = month - 1;
  let priorYear = year;
  
  if (priorMonth < 1) {
    priorMonth = 12;
    priorYear = year - 1;
  }
  
  // Get all invoices and filter manually
  const response = await client.accountingApi.getInvoices(tenantId);
  
  const allInvoices = response.body.invoices || [];
  const priorInvoices = allInvoices.filter(inv => {
    const invDate = new Date(inv.date);
    return inv.contact?.name === contactName && 
           invDate.getMonth() + 1 === priorMonth &&
           invDate.getFullYear() === priorYear &&
           inv.status === 'DRAFT';
  });
  
  return priorInvoices;
}

/**
 * Create a draft invoice in Xero
 * @param {string} contactName - Contact name
 * @param {Array} lineItems - Array of line item objects
 * @param {string} description - Invoice description/reference
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 */
export async function createDraftInvoice(contactName, lineItems, description, month, year) {
  const { client, tenantId } = await ensureValidToken();
  
  // Get or create contact
  const contact = await getOrCreateContact(contactName);
  
  // Delete any existing draft invoices for this contact
  await deleteExistingDraftInvoices(contactName);
  
  // Build invoice object - xero-node expects Date objects for dates
  const invoiceDate = new Date(year, month - 1, 1);
  const dueDate = new Date(year, month - 1, 15);
  
  const invoice = {
    contact: { contactID: contact.contactID },
    lineItems: lineItems.map(item => ({
      ...(item.itemCode && { itemCode: item.itemCode }),
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      taxType: item.taxType,
      accountCode: item.accountCode
    })),
    date: invoiceDate,
    dueDate: dueDate,
    reference: description,
    status: 'DRAFT',
    type: 'ACCREC'  // Accounts Receivable (invoice to client)
  };
  
  const response = await client.accountingApi.createInvoices(tenantId, {
    invoices: [invoice]
  });
  
  const createdInvoice = response.body.invoices[0];
  
  console.log(`   ✅ Created invoice: ${createdInvoice.invoiceNumber}`);
  
  return createdInvoice;
}

/**
 * Get invoices for a contact
 */
export async function getInvoicesForContact(contactName) {
  const { client, tenantId } = await ensureValidToken();
  
  const response = await client.accountingApi.getInvoices(tenantId, {
    where: `Contact.Name=="${contactName}"`,
    order: 'Date DESC'
  });
  
  return response.body.invoices || [];
}

/**
 * Test Xero connection
 */
export async function testConnection() {
  try {
    await initXero();
    console.log('✅ Xero API connection successful');
    return true;
  } catch (error) {
    console.error('❌ Xero API connection failed:', error.message);
    return false;
  }
}

/**
 * Get the initialized Xero client (for external use)
 */
export async function getXeroClient() {
  if (!xeroClient) {
    await initXero();
  }
  return { client: xeroClient, tenantId: currentTenantId };
}
