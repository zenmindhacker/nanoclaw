#!/usr/bin/env node

/**
 * Xero Workflows CLI
 * Usage: xero-workflows <command> [options]
 * 
 * Commands:
 *   auth               Start OAuth authentication
 *   pnl [--month M]    Get P&L report
 *   invoices           List invoices
 *   outstanding        Show outstanding invoices
 *   overdue            Show overdue invoices
 *   cashflow [--days N]  Cash flow summary
 *   budget             Compare budget (requires --sheet-id)
 *   chat               Interactive natural language mode
 */

import { Command } from 'commander';
import { createXeroWorkflows } from '../index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const program = new Command();

// Load config from environment or file
function getConfig() {
  const configPath = '/workspace/extra/credentials/xero-config.json';
  
  let clientId = process.env.XERO_CLIENT_ID;
  let clientSecret = process.env.XERO_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      clientId = clientId || config.clientId;
      clientSecret = clientSecret || config.clientSecret;
    }
  }
  
  if (!clientId || !clientSecret) {
    console.error('❌ XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set');
    console.log('   Either set environment variables or create /workspace/extra/credentials/xero-config.json');
    process.exit(1);
  }
  
  return { clientId, clientSecret };
}

program
  .name('xero-workflows')
  .description('Xero API workflows - P&L, Invoices, Budget')
  .version('1.0.0');

// Auth command
program
  .command('auth')
  .description('Start OAuth authentication')
  .action(async () => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    console.log('🔐 Starting OAuth flow...');
    await xero.authenticate();
    
    console.log('✅ Authentication complete!');
    console.log('   Tenant:', xero.getTenant()?.tenantName);
  });

// P&L command
program
  .command('pnl')
  .description('Get P&L report')
  .option('-m, --month <month>', 'Month (1-12)', parseInt)
  .option('-y, --year <year>', 'Year', parseInt)
  .option('-f, --from <date>', 'From date (YYYY-MM-DD)')
  .option('-t, --to <date>', 'To date (YYYY-MM-DD)')
  .action(async (options) => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    const initialized = await xero.initialize();
    if (!initialized) {
      console.log('❌ Not authenticated. Run: xero-workflows auth');
      process.exit(1);
    }
    
    const result = await xero.getPnL({
      month: options.month,
      year: options.year,
      fromDate: options.from,
      toDate: options.to
    });
    
    if (result.success) {
      console.log(result.formatted);
    } else {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }
  });

// Invoices command
program
  .command('invoices')
  .description('List invoices')
  .option('-s, --status <status>', 'Status (DRAFT|SUBMITTED|AUTHORISED|PAID|VOIDED)')
  .action(async (options) => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    const initialized = await xero.initialize();
    if (!initialized) {
      console.log('❌ Not authenticated. Run: xero-workflows auth');
      process.exit(1);
    }
    
    const result = await xero.listInvoices(
      options.status ? { status: options.status } : undefined
    );
    
    if (result.success) {
      console.log(result.formatted);
    } else {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }
  });

// Outstanding command
program
  .command('outstanding')
  .description('Show outstanding invoices')
  .action(async () => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    const initialized = await xero.initialize();
    if (!initialized) {
      console.log('❌ Not authenticated. Run: xero-workflows auth');
      process.exit(1);
    }
    
    const result = await xero.outstandingInvoices();
    
    if (result.success) {
      console.log(result.formatted);
    } else {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }
  });

// Overdue command
program
  .command('overdue')
  .description('Show overdue invoices')
  .action(async () => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    const initialized = await xero.initialize();
    if (!initialized) {
      console.log('❌ Not authenticated. Run: xero-workflows auth');
      process.exit(1);
    }
    
    const result = await xero.overdueInvoices();
    
    if (result.success) {
      console.log(result.formatted);
    } else {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }
  });

// Cashflow command
program
  .command('cashflow')
  .description('Cash flow summary')
  .option('-d, --days <days>', 'Number of days', parseInt, '30')
  .action(async (options) => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    const initialized = await xero.initialize();
    if (!initialized) {
      console.log('❌ Not authenticated. Run: xero-workflows auth');
      process.exit(1);
    }
    
    const result = await xero.cashflow(options.days);
    
    if (result.success) {
      console.log(result.formatted);
    } else {
      console.error('❌ Error:', result.error);
      process.exit(1);
    }
  });

// Chat/Natural Language mode
program
  .command('chat')
  .description('Interactive natural language mode')
  .action(async () => {
    const { clientId, clientSecret } = getConfig();
    const xero = createXeroWorkflows(clientId, clientSecret);
    
    const initialized = await xero.initialize();
    if (!initialized) {
      console.log('❌ Not authenticated. Run: xero-workflows auth');
      process.exit(1);
    }
    
    console.log('💬 Xero Chat Mode');
    console.log('   Type your questions or commands.');
    console.log('   Examples:');
    console.log('   - "how is my P&L this month?"');
    console.log('   - "any outstanding invoices?"');
    console.log('   - "show me overdue invoices"');
    console.log('   - "cash flow last 30 days"');
    console.log('   - "quit" to exit');
    console.log('');
    
    const readline = await import('readline');
    const rl = readline.default.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const ask = () => {
      rl.question('\n> ', async (query) => {
        if (query.toLowerCase() === 'quit' || query.toLowerCase() === 'exit') {
          rl.close();
          return;
        }
        
        const result = await xero.handleNaturalLanguage(query);
        
        if (result.success) {
          console.log('\n' + result.formatted);
        } else {
          console.log('\n❌', result.error);
        }
        
        ask();
      });
    };
    
    ask();
  });

program.parse();
