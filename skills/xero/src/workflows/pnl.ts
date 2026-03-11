/**
 * P&L (Profit & Loss) Workflow
 * "How's my P&L this month?"
 */

import type { XeroClientWrapper } from '../client/client.js';
import type { WorkflowResult, PnLParams } from '../types/index.js';

export class PnLWorkflow {
  constructor(private xero: XeroClientWrapper) {}

  /**
   * Get P&L report for a given period
   */
  async execute(params: PnLParams = {}): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();
      
      // Calculate dates
      const now = new Date();
      const year = params.year || now.getFullYear();
      const month = params.month || (params.fromDate ? undefined : now.getMonth() + 1);
      
      let fromDate = params.fromDate;
      let toDate = params.toDate;
      
      if (!fromDate && !toDate && month) {
        // Default to current month
        fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        toDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
      }

      if (!fromDate || !toDate) {
        // Default to year-to-date
        fromDate = params.fromDate || `${year}-01-01`;
        toDate = params.toDate || `${year}-12-31`;
      }

      const response = await api.accountingApi.getReportProfitAndLoss(
        tenant.tenantId,
        fromDate,
        toDate
      );

      const report = response.body.reports?.[0];
      
      if (!report) {
        return { success: false, error: 'No report data found' };
      }

      // Parse the P&L into a readable format
      const formatted = this.formatPnL(report, fromDate, toDate);
      
      return {
        success: true,
        data: report,
        formatted
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to get P&L'
      };
    }
  }

  /**
   * Format P&L report for display
   */
  private formatPnL(report: any, fromDate: string, toDate: string): string {
    const rows = report.rows || [];
    const lines: string[] = [];
    
    lines.push(`📊 Profit & Loss Report`);
    lines.push(`📅 ${fromDate} to ${toDate}`);
    lines.push('');
    
    let section = '';
    
    for (const row of rows) {
      if (row.rowType === 'Header') {
        continue;
      }
      
      if (row.rowType === 'SectionTitle') {
        section = this.getCellValue(row, 0);
        lines.push(`\n🏷️  ${section}`);
        continue;
      }
      
      if (row.rowType === 'SummaryRow') {
        const label = this.getCellValue(row, 0);
        const value = this.getCellValue(row, 1);
        lines.push(`   ${label}: ${value}`);
        continue;
      }
      
      if (row.rowType === 'Row') {
        const label = this.getCellValue(row, 0);
        const value = this.getCellValue(row, 1);
        if (label && value) {
          lines.push(`   ${label}: ${value}`);
        }
      }
    }
    
    return lines.join('\n');
  }

  private getCellValue(row: any, index: number): string {
    return row.cells?.[index]?.value || row.cells?.[index] || '';
  }
}
