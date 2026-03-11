/**
 * Budget Comparison Workflow
 * "Does my budget look accurate based on the invoices coming in?"
 */

import type { XeroClientWrapper } from '../client/client.js';
import type { WorkflowResult, BudgetCompareParams } from '../types/index.js';

// Note: This requires gog to be working for Sheets access
// For now, we'll implement the Xero side and provide a structure
// that can be extended once Sheets API is enabled

export class BudgetWorkflow {
  constructor(
    private xero: XeroClientWrapper,
    private gogAccount?: string
  ) {}

  /**
   * Compare budget from spreadsheet with actual Xero data
   */
  async compare(params: BudgetCompareParams): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      // Get actual data from Xero for the period
      const actuals = await this.getActuals(params.fromDate, params.toDate);
      
      // Try to get budget from spreadsheet
      let budget: any = null;
      try {
        budget = await this.getBudgetFromSheet(params.sheetId, params.sheetTab);
      } catch (err: any) {
        console.log('⚠️  Could not fetch budget sheet:', err.message);
      }

      // Compare and format
      const formatted = this.formatComparison(actuals, budget, params.fromDate, params.toDate);
      
      return {
        success: true,
        data: { actuals, budget },
        formatted
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to compare budget'
      };
    }
  }

  /**
   * Get actual expenses/revenue from Xero
   */
  private async getActuals(fromDate: string, toDate: string): Promise<any> {
    const api = this.xero.getApiClient();
    const tenant = this.xero.getTenant()!;

    // Get invoices (revenue - accounts receivable)
    const invoices = await api.getInvoices(
      tenant.tenantId,
      new Date(fromDate)
    );

    // Get bills (expenses - accounts payable)
    const bills = await api.getInvoices(
      tenant.tenantId,
      new Date(fromDate),
      'Type=="SPEND"' // where clause for bills
    );

    // Calculate totals
    const revenue = (invoices.body.invoices || [])
      .filter((inv: any) => inv.status === 'AUTHORISED' || inv.status === 'PAID')
      .reduce((sum: number, inv: any) => sum + parseFloat(inv.total || '0'), 0);

    const expenses = (bills.body.invoices || [])
      .filter((inv: any) => inv.status === 'AUTHORISED' || inv.status === 'PAID')
      .reduce((sum: number, inv: any) => sum + parseFloat(inv.total || '0'), 0);

    return {
      period: { from: fromDate, to: toDate },
      revenue,
      expenses,
      net: revenue - expenses,
      invoices: invoices.body.invoices?.length || 0,
      bills: bills.body.invoices?.length || 0
    };
  }

  /**
   * Get budget data from Google Sheet
   */
  private async getBudgetFromSheet(sheetId: string, tabName?: string): Promise<any> {
    if (!this.gogAccount) {
      throw new Error('GOG_ACCOUNT not configured');
    }

    const { exec } = await import('child_process');
    const tab = tabName || 'Budget';
    
    const result = await new Promise<string>((resolve, reject) => {
      exec(
        `GOG_ACCOUNT=${this.gogogAccount} gog sheets get "${sheetId}" "${tab}!A1:Z100" --json`,
        (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve(stdout);
        }
      );
    });

    return JSON.parse(result);
  }

  /**
   * Format comparison results
   */
  private formatComparison(actuals: any, budget: any, fromDate: string, toDate: string): string {
    const lines: string[] = [];
    
    lines.push(`📊 Budget vs Actual`);
    lines.push(`📅 Period: ${fromDate} to ${toDate}`);
    lines.push('');

    // If no budget provided, just show actuals
    if (!budget) {
      lines.push('💵 Actual Results (no budget sheet provided)');
      lines.push(`   Revenue: $${actuals.revenue.toFixed(2)}`);
      lines.push(`   Expenses: $${actuals.expenses.toFixed(2)}`);
      lines.push(`   ─────────────────────`);
      lines.push(`   Net: $${actuals.net.toFixed(2)}`);
      lines.push('');
      lines.push(`📈 ${actuals.invoices} invoices, ${actuals.bills} bills`);
      return lines.join('\n');
    }

    // Compare budget vs actual
    lines.push(`┌─────────────────────────────────────────────┐`);
    lines.push(`│              Budget    │    Actual   │ Diff  │`);
    lines.push(`├─────────────────────────────────────────────┤`);
    
    const revenueDiff = actuals.revenue - (budget.revenue || 0);
    const expenseDiff = actuals.expenses - (budget.expenses || 0);
    const netDiff = actuals.net - (budget.net || 0);
    
    const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;
    const diffStr = (d: number) => d >= 0 ? `+${fmt(d)}` : `-${fmt(d)}`;
    
    lines.push(`│ Revenue    │ ${fmt(budget.revenue || 0).padStart(10)} │ ${fmt(actuals.revenue).padStart(9)} │ ${diffStr(revenueDiff).padStart(5)} │`);
    lines.push(`│ Expenses   │ ${fmt(budget.expenses || 0).padStart(10)} │ ${fmt(actuals.expenses).padStart(9)} │ ${diffStr(expenseDiff).padStart(5)} │`);
    lines.push(`├─────────────────────────────────────────────┤`);
    lines.push(`│ Net        │ ${fmt(budget.net || 0).padStart(10)} │ ${fmt(actuals.net).padStart(9)} │ ${diffStr(netDiff).padStart(5)} │`);
    lines.push(`└─────────────────────────────────────────────┘`);

    // Analysis
    lines.push('');
    const pct = budget.revenue > 0 ? ((actuals.revenue / budget.revenue) * 100).toFixed(1) : 'N/A';
    lines.push(`📈 Revenue is ${pct}% of budget`);

    if (netDiff > 0) {
      lines.push(`✅ ${fmt(netDiff)} ahead of budget!`);
    } else if (netDiff < 0) {
      lines.push(`⚠️  ${fmt(Math.abs(netDiff))} behind budget`);
    }

    return lines.join('\n');
  }

  /**
   * Quick cash flow summary
   */
  async cashflow(days: number = 30): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const toDate = new Date().toISOString().split('T')[0];
      const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
        .toISOString().split('T')[0];

      const actuals = await this.getActuals(fromDate, toDate);
      
      return {
        success: true,
        data: actuals,
        formatted: `💰 Cash Flow (Last ${days} days)\n\n` +
          `   Revenue: $${actuals.revenue.toFixed(2)}\n` +
          `   Expenses: $${actuals.expenses.toFixed(2)}\n` +
          `   ────────────────\n` +
          `   Net: $${actuals.net.toFixed(2)}\n\n` +
          `📊 Activity:\n` +
          `   ${actuals.invoices} invoices\n` +
          `   ${actuals.bills} bills\n` +
          `   ${actuals.bankTransactions} bank txns`
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
