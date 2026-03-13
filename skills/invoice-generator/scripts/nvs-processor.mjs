/**
 * NVS Email Processor
 * Processes New Value Solutions emails from Gmail:
 *   AR flow: ar@ invoices (Rustam) → verify Toggl → Xero bill
 *   AP flow: ap@ purchase orders → Xero invoice (ACCREC)
 *
 * Usage: node nvs-processor.mjs --flow ar|ap|all [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import * as gmail from './gmail-helpers.mjs';
import * as toggl from './toggl-helpers.mjs';
import * as xero from './xero-helpers.mjs';

const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf8'));
const nvsClient = config.clients.nvs;
const nvsProject = config.projects.nvs;
const processing = nvsClient.processing;

/**
 * Parse CLI args
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { flow: 'all', dryRun: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--flow' && args[i + 1]) { opts.flow = args[i + 1]; i++; }
    if (args[i] === '--dry-run') opts.dryRun = true;
  }

  if (!['ar', 'ap', 'all'].includes(opts.flow)) {
    console.error('Invalid flow. Use: --flow ar|ap|all');
    process.exit(1);
  }

  return opts;
}

/**
 * Post to Slack #sysops (if webhook configured)
 */
async function postToSlack(text) {
  const webhook = config.slack?.sysopsWebhook;
  if (!webhook) {
    console.log('   📢 [Slack disabled] ' + text);
    return;
  }

  const url = new URL(webhook);
  const body = JSON.stringify({ text });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Infer billing period from email subject, using the email date as context
 * for year inference when only a month name is present.
 */
function inferPeriod(subject, emailDateStr) {
  const parsed = gmail.parseMonthFromText(subject);
  if (!parsed) return null;

  if (!parsed.year) {
    // Use email date to infer year. If the month name refers to a month
    // that would be >2 months in the future relative to the email date,
    // assume it means the prior year.
    const emailDate = new Date(emailDateStr);
    const emailYear = emailDate.getFullYear();
    const emailMonth = emailDate.getMonth() + 1;

    // How far ahead is the parsed month from the email month?
    const diff = parsed.month - emailMonth;
    if (diff > 2) {
      // e.g. email from Jan 2026, subject says "November" → 2025
      parsed.year = emailYear - 1;
    } else {
      parsed.year = emailYear;
    }
  }

  return parsed;
}

/**
 * Get date range for a month (first day to last day)
 */
function getMonthRange(year, month) {
  const since = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const until = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { since, until };
}

/**
 * Save PDF attachment to disk
 */
function savePdf(buffer, filename) {
  const dir = resolve(homedir(), '.openclaw/nvs-attachments');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = resolve(dir, filename);
  writeFileSync(path, buffer);
  return path;
}

/**
 * Parse invoice amount from attachment filename.
 * e.g. "Cognitive Technology - 9213 - 260301 - $661.50 - Invoice (Akimov).pdf" → 661.50
 */
function parseAmountFromFilename(filename) {
  const match = filename.match(/\$\s?([\d,]+\.?\d*)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : null;
}

/**
 * Parse hours from timecard attachment filename.
 * e.g. "Cognitive Technology - 9213 - 260301 - 7hrs - Timecard (Akimov).pdf" → 7
 */
function parseHoursFromFilename(filename) {
  const match = filename.match(/([\d.]+)\s*hrs?/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Parse PO number from subject. Handles:
 *   "Jan 2026 PO# 836", "PO#836", "December 2025 PO#830", "PO for November #823", "#823"
 */
function parsePONumber(subject) {
  // Try PO# followed by digits
  let match = subject.match(/PO#?\s*(\d+)/i);
  if (match) return match[1];
  // Try standalone #digits (e.g. "PO for November #823")
  match = subject.match(/#(\d{3,})/);
  if (match) return match[1];
  return null;
}

// ─── AR FLOW ─────────────────────────────────────────────────────────────────

async function processArEmails(dryRun) {
  console.log('\n📥 AR Flow: Processing ar@ invoices (Rustam → Xero bills)');
  console.log('   Sender:', processing.ar.sender);

  const labelId = await gmail.getOrCreateLabel(processing.processedLabel);
  const query = `from:${processing.ar.sender} -label:${processing.processedLabel}`;
  const searchResult = await gmail.searchMessages(query, 10);
  const messages = searchResult.messages || [];

  if (messages.length === 0) {
    console.log('   No unprocessed ar@ emails found.');
    return;
  }

  console.log(`   Found ${messages.length} unprocessed email(s)\n`);

  for (const msg of messages) {
    const full = await gmail.getMessage(msg.id);
    const parsed = gmail.parseMessage(full);
    console.log(`   ── Email: ${parsed.subject}`);
    console.log(`      Date: ${parsed.date}`);

    // Infer billing period (using email date for year context)
    const period = inferPeriod(parsed.subject, parsed.date);
    if (!period) {
      console.log('      ⚠️ Could not determine billing period from subject. Skipping.');
      continue;
    }
    const periodStr = `${period.year}-${String(period.month).padStart(2, '0')}`;
    console.log(`      Period: ${periodStr}`);

    // Pull Rustam's Toggl hours for this period (uses WW project, not NVS)
    const { since, until } = getMonthRange(period.year, period.month);
    const togglProjectId = processing.ar.togglProjectId || nvsProject.id;
    const togglHours = await toggl.getTotalProjectHours(
      togglProjectId, since, until, [processing.ar.billableUser]
    );
    console.log(`      Toggl hours (${processing.ar.billableUser}): ${togglHours.totalHours}h (${since} to ${until})`);

    // Download PDF attachments
    const pdfAttachments = parsed.attachments.filter(a =>
      a.mimeType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf')
    );
    console.log(`      Attachments: ${pdfAttachments.length} PDF(s)`);

    const downloadedPdfs = [];
    let invoiceAmount = null;
    let timecardHours = null;

    for (const att of pdfAttachments) {
      if (!att.attachmentId) continue;
      const buffer = await gmail.downloadAttachment(msg.id, att.attachmentId);
      const savedPath = savePdf(buffer, `ar-${periodStr.replace('-', '')}-${att.filename}`);
      downloadedPdfs.push({ filename: att.filename, buffer, savedPath });
      console.log(`      📄 Downloaded: ${att.filename} (${buffer.length} bytes)`);

      // Parse amount and hours from filenames
      if (att.filename.toLowerCase().includes('invoice')) {
        invoiceAmount = parseAmountFromFilename(att.filename);
        if (invoiceAmount) console.log(`      💰 Invoice amount (from filename): $${invoiceAmount}`);
      }
      if (att.filename.toLowerCase().includes('timecard')) {
        timecardHours = parseHoursFromFilename(att.filename);
        if (timecardHours) console.log(`      ⏱️  Timecard hours (from filename): ${timecardHours}h`);
      }
    }

    // Compare timecard hours vs Toggl
    let hoursMatch = true;
    if (timecardHours !== null && togglHours.totalHours > 0) {
      if (Math.abs(timecardHours - togglHours.totalHours) > 0.25) {
        hoursMatch = false;
        console.log(`      ⚠️ HOURS MISMATCH: Timecard=${timecardHours}h vs Toggl=${togglHours.totalHours}h`);
      } else {
        console.log(`      ✅ Hours match: Timecard=${timecardHours}h ≈ Toggl=${togglHours.totalHours}h`);
      }
    } else if (togglHours.totalHours === 0 && timecardHours) {
      console.log(`      ⚠️ Toggl shows 0h but timecard claims ${timecardHours}h — check Toggl project/user filter`);
      hoursMatch = false;
    }

    if (dryRun) {
      console.log('      🏷️  [DRY RUN] Would create Xero bill and label email');
      continue;
    }

    // Create Xero bill (ACCPAY)
    // Bill date = 1st of month after billing period, due = last day of that month
    const billDate = new Date(period.year, period.month, 1);
    const lastDay = new Date(period.year, period.month + 1, 0).getDate();
    const dueDate = new Date(period.year, period.month, lastDay);
    const reference = `${processing.ar.billDescription} (${periodStr})`;

    // Use invoice amount from filename, or timecard hours as quantity with $0 rate
    const quantity = timecardHours || togglHours.totalHours || 1;
    const unitAmount = invoiceAmount && timecardHours
      ? Math.round(invoiceAmount / timecardHours * 100) / 100
      : 0;

    const lineItems = [{
      description: `${processing.ar.billDescription} - ${periodStr}`,
      quantity: quantity,
      unitAmount: unitAmount,
      taxType: processing.ar.billTaxType,
      accountCode: processing.ar.billAccountCode
    }];

    try {
      const bill = await xero.createDraftBill(
        nvsClient.contactName, lineItems, reference, billDate, dueDate
      );

      // Attach PDFs to the bill
      for (const pdf of downloadedPdfs) {
        try {
          await xero.attachPdfToInvoice(bill.invoiceID, pdf.filename, pdf.buffer);
        } catch (err) {
          console.log(`      ⚠️ Failed to attach ${pdf.filename}: ${err.message}`);
        }
      }

      // Label email as processed
      await gmail.addLabel(msg.id, labelId);
      const billNum = bill.invoiceNumber || bill.invoiceID?.slice(0, 8);
      console.log(`      ✅ Bill ${billNum} created, email labeled`);

      // Slack notification
      const total = unitAmount > 0 ? `$${(quantity * unitAmount).toFixed(2)}` : 'verify in Xero';
      let slackMsg = `📥 *NVS AR* — Bill ${billNum} created\n` +
        `Period: ${periodStr} | ${quantity}h @ $${unitAmount}/hr = ${total}`;
      if (!hoursMatch) {
        slackMsg += `\n⚠️ HOURS DISCREPANCY: Timecard=${timecardHours}h vs Toggl=${togglHours.totalHours}h — manual review needed`;
      }
      await postToSlack(slackMsg);

    } catch (err) {
      console.log(`      ❌ Failed to create bill: ${err.message}`);
      await postToSlack(`❌ NVS AR bill creation failed for ${periodStr}: ${err.message}`);
    }
  }
}

// ─── AP FLOW ─────────────────────────────────────────────────────────────────

async function processApEmails(dryRun) {
  console.log('\n📤 AP Flow: Processing ap@ purchase orders (PO → Xero invoices)');
  console.log('   Sender:', processing.ap.sender);

  const labelId = await gmail.getOrCreateLabel(processing.processedLabel);
  const query = `from:${processing.ap.sender} -label:${processing.processedLabel}`;
  const searchResult = await gmail.searchMessages(query, 10);
  const messages = searchResult.messages || [];

  if (messages.length === 0) {
    console.log('   No unprocessed ap@ emails found.');
    return;
  }

  console.log(`   Found ${messages.length} unprocessed email(s)\n`);

  for (const msg of messages) {
    const full = await gmail.getMessage(msg.id);
    const parsed = gmail.parseMessage(full);
    console.log(`   ── Email: ${parsed.subject}`);
    console.log(`      Date: ${parsed.date}`);

    // Parse PO number from subject
    const poNumber = parsePONumber(parsed.subject);
    if (poNumber) console.log(`      PO#: ${poNumber}`);

    // Require a PDF attachment — replies/threads without POs are just conversation
    const pdfAttachments = parsed.attachments.filter(a =>
      a.mimeType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf')
    );
    if (pdfAttachments.length === 0) {
      console.log('      ⏭️  No PDF attachment — skipping (likely a reply thread).');
      // Still label it so we don't re-process
      if (!dryRun) await gmail.addLabel(msg.id, labelId);
      continue;
    }

    // Infer period (using email date for year context)
    const period = inferPeriod(parsed.subject, parsed.date);
    if (!period) {
      console.log('      ⚠️ Could not determine period from subject. Skipping.');
      continue;
    }
    const periodStr = `${period.year}-${String(period.month).padStart(2, '0')}`;
    console.log(`      Period: ${periodStr}`);

    // Download PO PDFs and extract amount from filename (preferred over body)
    let amount = null;
    const downloadedPdfs = [];
    for (const att of pdfAttachments) {
      if (!att.attachmentId) continue;
      const buffer = await gmail.downloadAttachment(msg.id, att.attachmentId);
      const savedPath = savePdf(buffer, `ap-PO${poNumber || 'unknown'}-${att.filename}`);
      downloadedPdfs.push({ filename: att.filename, buffer, savedPath });
      console.log(`      📄 Downloaded: ${att.filename} (${buffer.length} bytes)`);

      // Parse amount from PO filename (e.g. "$313.50 - PO.pdf")
      if (!amount) {
        const filenameAmount = parseAmountFromFilename(att.filename);
        if (filenameAmount) {
          amount = filenameAmount;
          console.log(`      💰 Amount (from filename): $${amount}`);
        }
      }
    }

    // Fall back to email body for amount
    if (!amount) {
      const bodyAmountMatch = parsed.body.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
      if (bodyAmountMatch) {
        amount = parseFloat(bodyAmountMatch[1].replace(/,/g, ''));
        console.log(`      💰 Amount (from body): $${amount}`);
      }
    }

    if (dryRun) {
      console.log('      🏷️  [DRY RUN] Would create Xero invoice and label email');
      continue;
    }

    // Create Xero invoice (ACCREC) — POs from NVS = money they owe us
    // Skip draft deletion so multiple PO invoices coexist
    const invoiceMonth = period.month;
    const invoiceYear = period.year;
    const reference = poNumber
      ? `PO# ${poNumber} - ${periodStr}`
      : `${processing.ap.invoiceDescription} - ${periodStr}`;

    const lineItems = [{
      description: poNumber
        ? `${processing.ap.invoiceDescription} - PO# ${poNumber}`
        : `${processing.ap.invoiceDescription}`,
      quantity: 1,
      unitAmount: amount || 0,
      taxType: processing.ap.invoiceTaxType,
      accountCode: processing.ap.invoiceAccountCode
    }];

    try {
      const invoice = await xero.createDraftInvoice(
        nvsClient.contactName, lineItems, reference, invoiceMonth, invoiceYear,
        { skipDraftDeletion: true }
      );

      // Attach PO PDF
      for (const pdf of downloadedPdfs) {
        try {
          await xero.attachPdfToInvoice(invoice.invoiceID, pdf.filename, pdf.buffer);
        } catch (err) {
          console.log(`      ⚠️ Failed to attach ${pdf.filename}: ${err.message}`);
        }
      }

      // Label email as processed
      await gmail.addLabel(msg.id, labelId);
      console.log(`      ✅ Invoice ${invoice.invoiceNumber} created, email labeled`);

      // Slack notification
      const amountStr = amount ? `\$${amount}` : '\$0 (verify against PO PDF)';
      const slackMsg = `📤 *NVS AP* — Invoice ${invoice.invoiceNumber} created\n` +
        `PO# ${poNumber || 'N/A'} | Period: ${periodStr} | Amount: ${amountStr}`;
      await postToSlack(slackMsg);

    } catch (err) {
      console.log(`      ❌ Failed to create invoice: ${err.message}`);
      await postToSlack(`❌ NVS AP invoice creation failed for PO# ${poNumber || 'N/A'}: ${err.message}`);
    }
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎯 NVS Email Processor\n======================');
  const { flow, dryRun } = parseArgs();

  if (dryRun) console.log('⚡ DRY RUN MODE — no Xero entries or labels will be created\n');

  // Init Xero (unless dry run)
  if (!dryRun) {
    console.log('🔌 Connecting to Xero...');
    await xero.initXero();
  }

  if (flow === 'ar' || flow === 'all') {
    await processArEmails(dryRun);
  }

  if (flow === 'ap' || flow === 'all') {
    await processApEmails(dryRun);
  }

  console.log('\n✨ Done!');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
