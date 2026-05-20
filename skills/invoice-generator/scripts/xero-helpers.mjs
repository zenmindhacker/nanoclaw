/**
 * Xero API Helpers
 * Handles OAuth2 tokens, invoice creation, and contact management
 */

import { XeroClient } from 'xero-node';
import { readFileSync } from 'fs';
import {
  loadXeroClientConfig,
  loadXeroTokens,
  resolveCredPath,
  assertXeroTokenFresh,
} from '../../xero/lib/xero-credentials.mjs';

// Xero OAuth redirect URI — must match what's registered in Xero developer console
const XERO_REDIRECT_URI = 'https://cleo.cognitivetech.net/auth/callback';

/**
 * Print the Xero OAuth re-auth URL to console.
 * Visit this URL, complete login, then paste the code back.
 */
export function printXeroAuthUrl() {
  const config = loadXeroClientConfig();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.client_id,
    redirect_uri: XERO_REDIRECT_URI,
    scope: 'openid profile email accounting.transactions accounting.contacts accounting.attachments offline_access',
    state: 'nanoclaw',
  });
  console.log(`\nXero re-auth URL:\nhttps://login.xero.com/identity/connect/authorize?${params}\n`);
}

let xeroClient = null;
let currentTenantId = null;

/**
 * Initialize Xero client and authenticate.
 * Token refresh is owned by the host OAuth refresher — containers read tokens only.
 */
export async function initXero() {
  const config = loadXeroClientConfig();

  xeroClient = new XeroClient({
    clientId: config.client_id,
    clientSecret: config.client_secret,
  });

  const tokens = loadXeroTokens();
  assertXeroTokenFresh(tokens);

  await xeroClient.setTokenSet(tokens);

  await xeroClient.updateTenants();

  if (xeroClient.tenants.length === 0) {
    throw new Error('No Xero tenants found');
  }

  currentTenantId = xeroClient.tenants[0].tenantId;

  console.log(`✅ Xero connected: ${xeroClient.tenants[0].tenantName}`);

  return { client: xeroClient, tenantId: currentTenantId };
}

/**
 * Ensure we have valid tokens - reuse existing client if already initialized
 */
export async function ensureValidToken() {
  if (xeroClient && currentTenantId) {
    return { client: xeroClient, tenantId: currentTenantId };
  }

  await initXero();
  return { client: xeroClient, tenantId: currentTenantId };
}

/**
 * Get or create a contact in Xero
 */
export async function getOrCreateContact(contactName) {
  const { client, tenantId } = await ensureValidToken();

  const response = await client.accountingApi.getContacts(tenantId);

  const contacts = response.body.contacts || [];
  const existingContact = contacts.find((c) => c.name === contactName);

  if (existingContact) {
    return existingContact;
  }

  const newContact = {
    name: contactName,
  };

  const createResponse = await client.accountingApi.createContacts(tenantId, {
    contacts: [newContact],
  });

  return createResponse.body.contacts[0];
}

/**
 * Find existing draft invoices for a contact and delete them
 */
export async function deleteExistingDraftInvoices(contactName) {
  const { client, tenantId } = await ensureValidToken();

  const response = await client.accountingApi.getInvoices(tenantId);

  const allInvoices = response.body.invoices || [];
  const drafts = allInvoices.filter(
    (inv) => inv.contact?.name === contactName && inv.status === 'DRAFT',
  );

  if (drafts.length > 0) {
    console.log(`   🗑️  Found ${drafts.length} existing draft(s) for ${contactName}`);

    for (const invoice of drafts) {
      try {
        const updatedInvoice = {
          ...invoice,
          status: 'DELETED',
        };

        await client.accountingApi.updateInvoice(tenantId, invoice.invoiceID, {
          invoices: [updatedInvoice],
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

  let priorMonth = month - 1;
  let priorYear = year;

  if (priorMonth < 1) {
    priorMonth = 12;
    priorYear = year - 1;
  }

  const response = await client.accountingApi.getInvoices(tenantId);

  const allInvoices = response.body.invoices || [];
  const priorInvoices = allInvoices.filter((inv) => {
    const invDate = new Date(inv.date);
    return (
      inv.contact?.name === contactName &&
      invDate.getMonth() + 1 === priorMonth &&
      invDate.getFullYear() === priorYear &&
      inv.status === 'DRAFT'
    );
  });

  return priorInvoices;
}

/**
 * Create a draft invoice in Xero
 */
export async function createDraftInvoice(
  contactName,
  lineItems,
  description,
  month,
  year,
  { skipDraftDeletion = false, taxInclusive = false } = {},
) {
  const { client, tenantId } = await ensureValidToken();

  const contact = await getOrCreateContact(contactName);

  if (!skipDraftDeletion) await deleteExistingDraftInvoices(contactName);

  const invoiceDate = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const dueDate = new Date(year, month, lastDay);

  const invoice = {
    contact: { contactID: contact.contactID },
    lineItems: lineItems.map((item) => ({
      ...(item.itemCode && { itemCode: item.itemCode }),
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      taxType: item.taxType,
      accountCode: item.accountCode,
    })),
    date: invoiceDate,
    dueDate: dueDate,
    reference: description,
    status: 'DRAFT',
    type: 'ACCREC',
    lineAmountTypes: taxInclusive ? 'Inclusive' : 'Exclusive',
  };

  const response = await client.accountingApi.createInvoices(tenantId, {
    invoices: [invoice],
  });

  const createdInvoice = response.body.invoices[0];

  console.log(`   ✅ Created invoice: ${createdInvoice.invoiceNumber}`);

  return createdInvoice;
}

/**
 * Create a draft bill (Accounts Payable) in Xero
 */
export async function createDraftBill(
  contactName,
  lineItems,
  reference,
  billDate,
  dueDate,
  { skipDraftDeletion = false } = {},
) {
  const { client, tenantId } = await ensureValidToken();

  const contact = await getOrCreateContact(contactName);

  if (!skipDraftDeletion) {
    const response = await client.accountingApi.getInvoices(tenantId);
    const allInvoices = response.body.invoices || [];
    const draftBills = allInvoices.filter(
      (inv) =>
        inv.contact?.name === contactName && inv.status === 'DRAFT' && inv.type === 'ACCPAY',
    );
    for (const bill of draftBills) {
      try {
        await client.accountingApi.updateInvoice(tenantId, bill.invoiceID, {
          invoices: [{ ...bill, status: 'DELETED' }],
        });
        console.log(`   🗑️  Deleted existing draft bill: ${bill.invoiceNumber}`);
      } catch (err) {
        console.log(`   ⚠️ Could not delete ${bill.invoiceNumber}: ${err.message}`);
      }
    }
  }

  const bill = {
    contact: { contactID: contact.contactID },
    lineItems: lineItems.map((item) => ({
      ...(item.itemCode && { itemCode: item.itemCode }),
      description: item.description,
      quantity: item.quantity,
      unitAmount: item.unitAmount,
      taxType: item.taxType,
      accountCode: item.accountCode,
    })),
    date: billDate,
    dueDate: dueDate,
    reference: reference,
    status: 'DRAFT',
    type: 'ACCPAY',
  };

  const createResponse = await client.accountingApi.createInvoices(tenantId, {
    invoices: [bill],
  });

  const createdBill = createResponse.body.invoices[0];
  console.log(`   ✅ Created bill: ${createdBill.invoiceNumber}`);
  return createdBill;
}

/**
 * Attach a PDF buffer to an existing invoice/bill by invoice ID
 */
export async function attachPdfToInvoice(invoiceId, filename, pdfBuffer) {
  const tokens = loadXeroTokens();
  const { tenantId } = await ensureValidToken();

  const url = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/Attachments/${encodeURIComponent(filename)}?IncludeOnline=true`;

  const { default: axios } = await import('axios');
  await axios({
    method: 'POST',
    url,
    data: pdfBuffer,
    headers: {
      Authorization: 'Bearer ' + tokens.access_token,
      'Content-Type': 'application/pdf',
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
      'Content-Length': pdfBuffer.length,
    },
  });

  console.log(`   📎 Attached ${filename} (IncludeOnline: true)`);
}

/**
 * Get invoices for a contact
 */
export async function getInvoicesForContact(contactName) {
  const { client, tenantId } = await ensureValidToken();

  const response = await client.accountingApi.getInvoices(tenantId, {
    where: `Contact.Name=="${contactName}"`,
    order: 'Date DESC',
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
