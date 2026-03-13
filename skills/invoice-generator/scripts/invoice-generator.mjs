/**
 * Invoice Generator
 * Creates Xero invoices from Toggl time entries
 * 
 * Usage: node scripts/invoice-generator.mjs --client [copperteams|ganttsy|work-wranglers|kevin-lee|nvs|all] --month 2026-02
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir, tmpdir } from 'os';
import https from 'https';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import helpers
import * as toggl from './toggl-helpers.mjs';
import * as xero from './xero-helpers.mjs';

// Load config
const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf8'));

// Global Xero client (reused across all invoices)
let xeroClientInstance = null;
let xeroProducts = null;

/**
 * Parse command line arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { client: 'all', month: null };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--client' && args[i + 1]) { opts.client = args[i + 1]; i++; }
    else if (args[i] === '--month' && args[i + 1]) { opts.month = args[i + 1]; i++; }
  }
  
  const validClients = ['copperteams', 'ganttsy', 'work-wranglers', 'kevin-lee', 'nvs', 'all'];
  if (!validClients.includes(opts.client)) {
    console.error('Invalid client:', opts.client);
    process.exit(1);
  }
  if (!opts.month) { console.error('--month is required (format: YYYY-MM)'); process.exit(1); }
  
  const [year, month] = opts.month.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    console.error('Invalid month format. Use YYYY-MM (e.g., 2026-02)');
    process.exit(1);
  }
  return { client: opts.client, year, month };
}

/**
 * Calculate date range for prior month
 */
function getDateRange(year, month) {
  let priorMonth = month - 1;
  let priorYear = year;
  if (priorMonth < 1) { priorMonth = 12; priorYear = year - 1; }
  
  const since = priorYear + '-' + String(priorMonth).padStart(2, '0') + '-01';
  const lastDay = new Date(priorYear, priorMonth, 0).getDate();
  const until = priorYear + '-' + String(priorMonth).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  return { since, until, priorMonth, priorYear };
}

/**
 * Fetch Xero products
 */
async function fetchXeroProducts() {
  if (xeroProducts) return xeroProducts;
  console.log('📦 Fetching Xero products...');
  const { client, tenantId } = await xero.getXeroClient();
  const response = await client.accountingApi.getItems(tenantId);
  const items = response.body.items || [];
  xeroProducts = {};
  for (const item of items) {
    xeroProducts[item.code] = { name: item.name, unitPrice: item.salesDetails?.unitPrice, taxType: item.salesDetails?.taxType, accountCode: item.salesDetails?.accountCode };
  }
  console.log('   Found', Object.keys(xeroProducts).length, 'products');
  return xeroProducts;
}

/**
 * Get Toggl time entries for a project
 */
function getTogglEntries(workspaceId, projectId, since, until) {
  const apiToken = toggl.getTogglCredentials();
  const endpoint = '/reports/api/v2/details?workspace_id=' + workspaceId + '&since=' + since + '&until=' + until + '&project_ids=' + projectId;
  const auth = Buffer.from(apiToken + ':api_token').toString('base64');
  
  return new Promise((resolve, reject) => {
    const options = { hostname: 'api.track.toggl.com', path: endpoint, method: 'GET', headers: { 'Authorization': 'Basic ' + auth } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data).data || []); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Generate PDF report from Toggl entries
 */
async function generateTogglPdf(invoiceNumber, clientName, projectId, since, until, outputPath) {
  const entries = await getTogglEntries('8629306', projectId, since, until);
  let totalSeconds = 0;
  const userTotals = {};
  
  for (const entry of entries) {
    totalSeconds += entry.dur || 0;
    const user = entry.user || 'Unknown';
    if (!userTotals[user]) userTotals[user] = { seconds: 0, entries: 0 };
    userTotals[user].seconds += entry.dur || 0;
    userTotals[user].entries += 1;
  }
  
  const doc = new PDFDocument({ margin: 50 });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);
  
  doc.fontSize(20).text('Toggl Time Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text('Client: ' + clientName);
  doc.text('Invoice: ' + invoiceNumber);
  doc.text('Period: ' + since + ' to ' + until);
  doc.moveDown();
  doc.fontSize(14).text('Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text('Total Hours: ' + Math.round(totalSeconds / 3600 * 100) / 100);
  doc.text('Total Entries: ' + entries.length);
  doc.moveDown();
  doc.fontSize(14).text('By Team Member', { underline: true });
  doc.moveDown(0.5);
  for (const [user, data] of Object.entries(userTotals)) {
    doc.fontSize(12).text(user + ': ' + Math.round(data.seconds / 3600 * 100) / 100 + ' hours (' + data.entries + ' entries)');
  }
  doc.moveDown();
  doc.fontSize(14).text('Time Entries', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(10);
  for (const entry of entries.slice(0, 50)) {
    const hours = Math.round((entry.dur || 0) / 3600 * 100) / 100;
    const date = entry.start ? entry.start.split('T')[0] : 'N/A';
    doc.text(date + ' - ' + entry.user + ': ' + (entry.description || 'No description') + ' (' + hours + 'h)');
  }
  if (entries.length > 50) doc.text('... and ' + (entries.length - 50) + ' more entries');
  doc.moveDown(2);
  doc.fontSize(8).text('Generated: ' + new Date().toISOString(), { align: 'center' });
  doc.end();
  
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Export a PDF from Toggl using the dashboard export API.
 * Loads the saved custom report template (captured from browser) and injects
 * the billing period date range before posting.
 *
 * Templates live at skills/invoice-generator/templates/{ww,ct,ganttsy}.json
 * and were captured by intercepting browser network calls (2026-03-11).
 */
async function exportTogglPdf(projectId, since, until, clientName) {
  const apiToken = toggl.getTogglCredentials();
  const auth = Buffer.from(`${apiToken}:api_token`).toString('base64');
  const filename = `Toggl-Report-${clientName}-${since}-${until}.pdf`;

  // Map project IDs to saved dashboard template files
  const TEMPLATE_MAP = {
    '204851981': 'ww.json',      // Work Wranglers
    '214367650': 'ct.json',      // CopperTeams
    '215944745': 'ganttsy.json'  // Ganttsy
  };

  const templateFile = TEMPLATE_MAP[String(projectId)];
  if (!templateFile) {
    throw new Error(`No Toggl template for project ${projectId}`);
  }

  const templatePath = resolve(__dirname, '..', 'templates', templateFile);
  const body = JSON.parse(readFileSync(templatePath, 'utf8'));

  // Inject billing period date range into dashboard preferences
  body.dashboard.preferences.datePeriod = { from: since, to: until };

  // Update each chart's query.period in both dashboard.charts array and top-level charts object
  for (const chart of (body.dashboard.charts || [])) {
    if (chart.query) chart.query.period = { from: since, to: until };
  }
  for (const chart of Object.values(body.charts || {})) {
    if (chart.query) chart.query.period = { from: since, to: until };
  }

  const postData = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'track.toggl.com',
      path: `/exports/api/v1/dashboard.pdf?filename=${encodeURIComponent(filename)}`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => reject(new Error(`Toggl PDF API error: ${res.statusCode} - ${data.slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Toggl PDF request timed out')); });
    req.write(postData);
    req.end();
  });
}

/**
 * Attach Toggl PDF to Xero invoice
 */
async function attachTogglPdf(invoice, clientName, projectId, since, until) {
  console.log('   📎 Generating and attaching Toggl PDF report...');
  try {
    const pdfDir = resolve(homedir(), '.openclaw/toggl-reports');
    if (!existsSync(pdfDir)) mkdirSync(pdfDir, { recursive: true });
    const pdfPath = pdfDir + '/Toggl-Report-' + invoice.invoiceNumber + '.pdf';
    
    let pdfBuffer;
    let pdfSource = 'generated';
    
    // Export PDF directly from Toggl using the dashboard export API
    try {
      console.log('   🔄 Exporting PDF from Toggl...');
      pdfBuffer = await exportTogglPdf(projectId, since, until, clientName);
      pdfSource = 'toggl-export';
      console.log('   ✅ Downloaded PDF from Toggl (' + pdfBuffer.length + ' bytes)');
    } catch (togglError) {
      console.log('   ⚠️ Toggl PDF export failed: ' + togglError.message);
      console.log('   🔄 Falling back to generated PDF...');
    }
    
    // Fall back to generated PDF if Toggl export didn't work
    if (!pdfBuffer) {
      await generateTogglPdf(invoice.invoiceNumber, clientName, projectId, since, until, pdfPath);
      pdfBuffer = readFileSync(pdfPath);
      console.log('   📄 Generated PDF locally:', pdfPath);
    } else {
      // Save the downloaded PDF
      writeFileSync(pdfPath, pdfBuffer);
      console.log('   📄 Saved PDF:', pdfPath);
    }
    
    const filename = 'Toggl-Report-' + invoice.invoiceNumber + '.pdf';
    
    // Read PDF and upload to Xero
    const tokensPath = resolve(homedir(), '.openclaw/credentials/xero-tokens.json');
    const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'));
    
    const { client, tenantId } = await xero.getXeroClient();
    const response = await client.accountingApi.getInvoices(tenantId);
    const allInvoices = response.body.invoices || [];
    const inv = allInvoices.find(i => i.invoiceNumber === invoice.invoiceNumber);
    
    if (!inv) { console.log('   ⚠️ Invoice not found for attachment'); return; }
    
    const url = 'https://api.xero.com/api.xro/2.0/Invoices/' + inv.invoiceID + '/Attachments/' + filename + '?IncludeOnline=true';
    
    await axios({ method: 'POST', url: url, data: pdfBuffer, headers: { 'Authorization': 'Bearer ' + tokens.access_token, 'Content-Type': 'application/pdf', 'Xero-tenant-id': tenantId, 'Accept': 'application/json', 'Content-Length': pdfBuffer.length } });
    console.log('   ✅ PDF attached to invoice (source: ' + pdfSource + ', IncludeOnline: true)');
  } catch (error) {
    console.log('   ❌ Failed to attach PDF:', error.message);
  }
}

/**
 * Generate Work Wranglers invoice - with person-specific rates
 */
async function generateWorkWranglersInvoice(year, month) {
  console.log('\n📋 Generating Work Wranglers invoice...');
  const { since, until, priorMonth, priorYear } = getDateRange(year, month);
  const clientConfig = config.clients['work-wranglers'];
  const projectConfig = config.projects['work-wranglers'];
  
  const hours = await toggl.getWorkWranglersHours(since, until);
  console.log('   Hours for ' + since + ' to ' + until + ':');
  console.log('   - Cian (CTO): ' + toggl.secondsToHours(hours.cian) + ' hours');
  console.log('   - Cian (Discounted): ' + toggl.secondsToHours(hours.cianDiscounted) + ' hours');
  console.log('   - Rustam: ' + toggl.secondsToHours(hours.rustam) + ' hours');

  const lineItems = [];
  const personRates = clientConfig.personRates;
  const period = priorYear + '-' + String(priorMonth).padStart(2, '0');

  // Cian CTO Consulting — always included even at 0 hours
  const cianHours = toggl.secondsToHours(hours.cian);
  lineItems.push({ itemCode: personRates.cian.productCode, description: personRates.cian.description + ' (' + period + ')', quantity: cianHours, unitAmount: personRates.cian.rate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });
  console.log('   - Cian CTO: ' + cianHours + 'h @ $' + personRates.cian.rate + '/hr');

  // Cian Discounted (Management / Sales Consulting) — only if hours logged
  const cianDiscountedHours = toggl.secondsToHours(hours.cianDiscounted);
  if (cianDiscountedHours > 0) {
    lineItems.push({ itemCode: personRates.cianDiscounted.productCode, description: personRates.cianDiscounted.description + ' (' + period + ')', quantity: cianDiscountedHours, unitAmount: personRates.cianDiscounted.rate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });
    console.log('   - Cian Discounted: ' + cianDiscountedHours + 'h @ $' + personRates.cianDiscounted.rate + '/hr');
  }

  // Rustam — always included even at 0 hours
  const rustamHours = toggl.secondsToHours(hours.rustam);
  lineItems.push({ itemCode: personRates.rustam.productCode, description: personRates.rustam.description + ' (' + period + ')', quantity: rustamHours, unitAmount: personRates.rustam.rate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });
  console.log('   - Rustam: ' + rustamHours + 'h @ $' + personRates.rustam.rate + '/hr');
  
  const invoice = await xero.createDraftInvoice(clientConfig.contactName, lineItems, 'WW: Consulting - ' + year + '-' + String(month).padStart(2, '0'), month, year);
  await attachTogglPdf(invoice, 'Work Wranglers', projectConfig.id, since, until);
  return invoice;
}

/**
 * Generate CopperTeams invoice
 */
async function generateCopperTeamsInvoice(year, month) {
  console.log('\n📋 Generating CopperTeams (Kora MVP) invoice...');
  const { since, until, priorMonth, priorYear } = getDateRange(year, month);
  const clientConfig = config.clients['copperteams'];
  const projectConfig = config.projects['copperteams'];
  
  const hours = await toggl.getTotalProjectHours(projectConfig.id, since, until, clientConfig.billableUsers);
  console.log('   Hours for ' + since + ' to ' + until + ': ' + hours.totalHours + ' hours' + (clientConfig.billableUsers ? ' (filtered to: ' + clientConfig.billableUsers.join(', ') + ')' : ''));
  console.log('   Retainer: ' + clientConfig.retainerHours + ' hours @ $' + clientConfig.retainerRate + '/hr');

  const lineItems = [];
  lineItems.push({ itemCode: clientConfig.retainerItemCode, description: clientConfig.retainerDescription, quantity: clientConfig.retainerHours, unitAmount: clientConfig.retainerRate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });

  const excessHours = Math.max(0, Math.round((hours.totalHours - clientConfig.retainerHours) * 100) / 100);
  console.log('   Excess: ' + excessHours + ' hours @ $' + clientConfig.excessRate + '/hr');
  lineItems.push({ itemCode: clientConfig.excessItemCode, description: clientConfig.excessDescription, quantity: excessHours, unitAmount: clientConfig.excessRate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });

  const invoice = await xero.createDraftInvoice(clientConfig.contactName, lineItems, 'Kora MVP - ' + year + '-' + String(month).padStart(2, '0'), month, year);
  await attachTogglPdf(invoice, 'CopperTeams', projectConfig.id, since, until);
  return invoice;
}

/**
 * Generate Ganttsy invoice
 */
async function generateGanttsyInvoice(year, month) {
  console.log('\n📋 Generating Ganttsy (Ganttsy MVP) invoice...');
  const { since, until, priorMonth, priorYear } = getDateRange(year, month);
  const clientConfig = config.clients['ganttsy'];
  const projectConfig = config.projects['ganttsy'];
  
  const hours = await toggl.getTotalProjectHours(projectConfig.id, since, until, clientConfig.billableUsers);
  console.log('   Hours for ' + since + ' to ' + until + ': ' + hours.totalHours + ' hours' + (clientConfig.billableUsers ? ' (filtered to: ' + clientConfig.billableUsers.join(', ') + ')' : ''));
  console.log('   Retainer: ' + clientConfig.retainerHours + ' hours @ $' + clientConfig.retainerRate + '/hr');

  const lineItems = [];
  lineItems.push({ itemCode: clientConfig.retainerItemCode, description: clientConfig.retainerDescription, quantity: clientConfig.retainerHours, unitAmount: clientConfig.retainerRate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });

  const excessHours = Math.max(0, Math.round((hours.totalHours - clientConfig.retainerHours) * 100) / 100);
  console.log('   Excess: ' + excessHours + ' hours @ $' + clientConfig.excessRate + '/hr');
  lineItems.push({ itemCode: clientConfig.excessItemCode, description: clientConfig.excessDescription, quantity: excessHours, unitAmount: clientConfig.excessRate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode });

  const invoice = await xero.createDraftInvoice(clientConfig.contactName, lineItems, 'Ganttsy MVP - ' + year + '-' + String(month).padStart(2, '0'), month, year);
  await attachTogglPdf(invoice, 'Ganttsy', projectConfig.id, since, until);
  return invoice;
}

/**
 * Generate Kevin Lee invoice (copy from prior month)
 */
async function generateKevinLeeInvoice(year, month) {
  console.log('\n📋 Generating Kevin Lee invoice...');
  const clientConfig = config.clients['kevin-lee'];
  const projectConfig = config.projects['kevin-lee'];
  
  const lineItems = [{ itemCode: clientConfig.itemCode, description: clientConfig.retainerDescription, quantity: clientConfig.retainerHours, unitAmount: clientConfig.retainerRate, taxType: projectConfig.taxType, accountCode: projectConfig.accountCode }];
  const invoice = await xero.createDraftInvoice(clientConfig.contactName, lineItems, 'Executive Coaching - ' + year + '-' + String(month).padStart(2, '0'), month, year);
  return invoice;
}

/**
 * Generate NVS invoice (copy from prior month)
 */
async function generateNVSInvoice(year, month) {
  console.log('\n📋 Generating New Value Solutions invoice...');
  const clientConfig = config.clients['nvs'];
  const projectConfig = config.projects['nvs'];
  
  const lineItems = [{ description: 'NVS: CTO Consulting', quantity: 1, unitAmount: clientConfig.retainerRate, taxType: clientConfig.taxType || projectConfig.taxType, accountCode: clientConfig.accountCode || projectConfig.accountCode }];
  const invoice = await xero.createDraftInvoice(clientConfig.contactName, lineItems, 'NVS: CTO Consulting - ' + year + '-' + String(month).padStart(2, '0'), month, year);
  return invoice;
}

/**
 * Main function
 */
async function main() {
  console.log('🎯 Invoice Generator\n====================');
  const { client, year, month } = parseArgs();
  console.log('\nTarget: ' + (client === 'all' ? 'all clients' : client));
  console.log('Invoice month: ' + year + '-' + String(month).padStart(2, '0'));
  
  console.log('\n🔌 Connecting to Xero...');
  await xero.initXero();
  await fetchXeroProducts();
  
  let clientsToProcess = client === 'all' ? ['work-wranglers', 'copperteams', 'ganttsy', 'kevin-lee', 'nvs'] : [client];
  
  const results = {};
  
  for (const clientName of clientsToProcess) {
    try {
      switch (clientName) {
        case 'work-wranglers': results[clientName] = await generateWorkWranglersInvoice(year, month); break;
        case 'copperteams': results[clientName] = await generateCopperTeamsInvoice(year, month); break;
        case 'ganttsy': results[clientName] = await generateGanttsyInvoice(year, month); break;
        case 'kevin-lee': results[clientName] = await generateKevinLeeInvoice(year, month); break;
        case 'nvs': results[clientName] = await generateNVSInvoice(year, month); break;
      }
    } catch (error) {
      console.error('\n❌ Error generating ' + clientName + ' invoice:', error.message);
      results[clientName] = { error: error.message };
    }
  }
  
  console.log('\n📊 Summary\n==========');
  for (const [clientName, result] of Object.entries(results)) {
    if (result.error) console.log('❌ ' + clientName + ': ' + result.error);
    else console.log('✅ ' + clientName + ': ' + result.invoiceNumber);
  }
  
  console.log('\n✨ Done!');
}

main().catch(console.error);
