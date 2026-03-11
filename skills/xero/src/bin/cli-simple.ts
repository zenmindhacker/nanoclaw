#!/usr/bin/env node

/**
 * Xero Workflows CLI - Simplified version using working pattern
 */

import { XeroClient } from 'xero-node';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const CLIENT_ID = process.env.XERO_CLIENT_ID || '748CC12001CF4C89A17B5C7FBD7D9965';
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || 'Rfnrjqp9XOHfEShEfZm92XzW4n3ns11Aj5X4EFM3j0Z-ObWh';
const TOKEN_PATH = '/workspace/extra/credentials/xero-tokens.json';

let xero: XeroClient;
let tenantId: string;

async function init() {
  xero = new XeroClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  
  if (!existsSync(TOKEN_PATH)) {
    console.log('❌ No tokens found. Run: xero-workflows auth');
    process.exit(1);
  }
  
  const tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
  await xero.setTokenSet(tokens);
  await xero.updateTenants();
  
  if (xero.tenants.length === 0) {
    console.log('❌ No tenants found');
    process.exit(1);
  }
  
  tenantId = xero.tenants[0].tenantId;
  console.log(`Connected to: ${xero.tenants[0].tenantName}`);
}

async function cmdPnl(month?: number, year?: number) {
  await init();
  
  const now = new Date();
  const y = year || now.getFullYear();
  const m = month || now.getMonth() + 1;
  
  const fromDate = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const toDate = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
  
  console.log(`\n📊 P&L: ${fromDate} to ${toDate}\n`);
  
  try {
    const response = await xero.accountingApi.getReportProfitAndLoss(tenantId, fromDate, toDate);
    const report = response.body.reports?.[0];
    
    if (!report) {
      console.log('No report data');
      return;
    }
    
    // Simple formatting
    console.log(report.rows?.slice(0, 20).map((row: any) => {
      if (row.rowType === 'SectionTitle') {
        return `\n🏷️  ${row.cells?.[0]?.value || ''}`;
      }
      if (row.rowType === 'Row' || row.rowType === 'SummaryRow') {
        const label = row.cells?.[0]?.value || '';
        const value = row.cells?.[1]?.value || '';
        return value ? `   ${label}: ${value}` : '';
      }
      return '';
    }).filter(Boolean).join('\n'));
    
  } catch (err: any) {
    console.log('❌ Error:', err.message);
  }
}

async function cmdInvoices(status?: string) {
  await init();
  
  console.log(`\n📋 Invoices${status ? ` (${status})` : ''}\n`);
  
  try {
    let where = status ? `Status=="${status}"` : undefined;
    const response = await xero.accountingApi.getInvoices(tenantId, undefined, where);
    const invoices = response.body.invoices || [];
    
    if (invoices.length === 0) {
      console.log('No invoices found');
      return;
    }
    
    let total = 0;
    for (const inv of invoices.slice(0, 20)) {
      const s = { DRAFT: '📝', SUBMITTED: '📤', AUTHORISED: '✅', PAID: '💵', VOIDED: '🚫' }[inv.status] || '❓';
      const amount = parseFloat(inv.total || '0');
      total += amount;
      console.log(`${s} ${inv.invoiceNumber || 'N/A'} | ${inv.contact?.name || 'Unknown'} | $${amount.toFixed(2)} | Due: ${inv.dueDate || 'N/A'}`);
    }
    
    console.log(`\n💰 Total: $${total.toFixed(2)} (${invoices.length} invoices)`);
    
  } catch (err: any) {
    console.log('❌ Error:', err.message);
  }
}

async function cmdOutstanding() {
  await init();
  
  console.log('\n📋 Outstanding Invoices\n');
  
  try {
    const response = await xero.accountingApi.getInvoices(tenantId, undefined, 'Status=="AUTHORISED"');
    const invoices = response.body.invoices || [];
    
    if (invoices.length === 0) {
      console.log('✅ No outstanding invoices!');
      return;
    }
    
    let total = 0;
    for (const inv of invoices) {
      const amount = parseFloat(inv.total || '0');
      total += amount;
      console.log(`✅ ${inv.invoiceNumber || 'N/A'} | ${inv.contact?.name || 'Unknown'} | $${amount.toFixed(2)} | Due: ${inv.dueDate || 'N/A'}`);
    }
    
    console.log(`\n💰 Total Outstanding: $${total.toFixed(2)} (${invoices.length} invoices)`);
    
  } catch (err: any) {
    console.log('❌ Error:', err.message);
  }
}

async function cmdOverdue() {
  await init();
  
  console.log('\n⚠️  Overdue Invoices\n');
  
  try {
    const response = await xero.accountingApi.getInvoices(tenantId, undefined, 'Status=="AUTHORISED"');
    const today = new Date().toISOString().split('T')[0];
    
    const invoices = (response.body.invoices || []).filter((inv: any) => 
      inv.dueDate && inv.dueDate < today
    );
    
    if (invoices.length === 0) {
      console.log('✅ No overdue invoices!');
      return;
    }
    
    let total = 0;
    for (const inv of invoices) {
      const amount = parseFloat(inv.total || '0');
      total += amount;
      console.log(`⚠️  ${inv.invoiceNumber || 'N/A'} | ${inv.contact?.name || 'Unknown'} | $${amount.toFixed(2)} | Was due: ${inv.dueDate}`);
    }
    
    console.log(`\n💰 Total Overdue: $${total.toFixed(2)} (${invoices.length} invoices)`);
    
  } catch (err: any) {
    console.log('❌ Error:', err.message);
  }
}

async function cmdCashflow(days: number = 30) {
  await init();
  
  const toDate = new Date().toISOString().split('T')[0];
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];
  
  console.log(`\n💰 Cash Flow: Last ${days} days (${fromDate} to ${toDate})\n`);
  
  try {
    // Get invoices (revenue)
    const invResponse = await xero.accountingApi.getInvoices(tenantId, new Date(fromDate));
    const invoices = (invResponse.body.invoices || []).filter((inv: any) => 
      inv.status === 'AUTHORISED' || inv.status === 'PAID'
    );
    const revenue = invoices.reduce((sum: number, inv: any) => sum + parseFloat(inv.total || '0'), 0);
    
    // Get bills (expenses)
    const billsResponse = await xero.accountingApi.getInvoices(tenantId, new Date(fromDate), 'Type=="SPEND"');
    const bills = (billsResponse.body.invoices || []).filter((inv: any) => 
      inv.status === 'AUTHORISED' || inv.status === 'PAID'
    );
    const expenses = bills.reduce((sum: number, inv: any) => sum + parseFloat(inv.total || '0'), 0);
    
    console.log(`   Revenue:   $${revenue.toFixed(2)}`);
    console.log(`   Expenses:  $${expenses.toFixed(2)}`);
    console.log(`   ─────────────────`);
    console.log(`   Net:      $${(revenue - expenses).toFixed(2)}`);
    console.log(`\n   📊 ${invoices.length} invoices, ${bills.length} bills`);
    
  } catch (err: any) {
    console.log('❌ Error:', err.message);
  }
}

// CLI Routing
const cmd = process.argv[2];
const args = process.argv.slice(3);

switch (cmd) {
  case 'pnl': {
    const month = args.includes('-m') ? parseInt(args[args.indexOf('-m') + 1]) : undefined;
    const year = args.includes('-y') ? parseInt(args[args.indexOf('-y') + 1]) : undefined;
    cmdPnl(month, year);
    break;
  }
  case 'invoices':
    cmdInvoices(args[0]);
    break;
  case 'outstanding':
    cmdOutstanding();
    break;
  case 'overdue':
    cmdOverdue();
    break;
  case 'cashflow': {
    const daysIdx = args.indexOf('-d');
    const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : 30;
    cmdCashflow(days);
    break;
  }
  case 'auth':
    console.log('Run: node xero-test.mjs for auth flow');
    break;
  default:
    console.log(`
🔑 Xero Workflows CLI

Commands:
  pnl [-m month] [-y year]     Profit & Loss report
  invoices [status]            List invoices (DRAFT|SUBMITTED|AUTHORISED|PAID)
  outstanding                  Show unpaid invoices
  overdue                      Show overdue invoices
  cashflow [-d days]           Cash flow summary (default 30 days)
  auth                         Start OAuth flow

Examples:
  xero-workflows pnl
  xero-workflows pnl -m 1 -y 2026
  xero-workflows outstanding
  xero-workflows cashflow -d 90
`);
}
