/**
 * Xero Workflows - Main Index
 * Unified interface for all Xero operations
 */

import { XeroClientWrapper } from '../client/client.js';
import { PnLWorkflow } from './pnl.js';
import { InvoiceWorkflow } from './invoices.js';
import { BudgetWorkflow } from './budget.js';

export { PnLWorkflow } from './pnl.js';
export { InvoiceWorkflow } from './invoices.js';
export { BudgetWorkflow } from './budget.js';
export type { WorkflowResult, WorkflowParams } from '../types/index.js';

/**
 * Main Xero Workflows class
 * Provides a unified interface to all Xero operations
 */
export class XeroWorkflows {
  private client: XeroClientWrapper;
  private pnl: PnLWorkflow;
  private invoices: InvoiceWorkflow;
  private budget: BudgetWorkflow;

  constructor(
    clientId: string,
    clientSecret: string,
    options?: {
      redirectUri?: string;
      tokenPath?: string;
      gogAccount?: string;
    }
  ) {
    this.client = new XeroClientWrapper(
      clientId,
      clientSecret,
      options?.redirectUri,
      options?.tokenPath
    );

    this.pnl = new PnLWorkflow(this.client);
    this.invoices = new InvoiceWorkflow(this.client);
    this.budget = new BudgetWorkflow(this.client, options?.gogAccount);
  }

  /**
   * Authenticate with Xero (starts OAuth flow)
   */
  async authenticate(): Promise<void> {
    await this.client.authenticateWithServer();
  }

  /**
   * Initialize with existing tokens
   */
  async initialize(): Promise<boolean> {
    return await this.client.initialize();
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.client.isAuthenticated();
  }

  /**
   * Get current tenant info
   */
  getTenant() {
    return this.client.getTenant();
  }

  // P&L Operations
  /**
   * Get P&L report
   * @param params - fromDate, toDate, month, year
   */
  async getPnL(params?: {
    fromDate?: string;
    toDate?: string;
    month?: number;
    year?: number;
  }): Promise<WorkflowResult> {
    return await this.pnl.execute(params || {});
  }

  // Invoice Operations
  /**
   * List invoices
   */
  async listInvoices(params?: {
    status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'PAID' | 'VOIDED' | 'DELETED';
    dueDate?: string;
    contactId?: string;
  }): Promise<WorkflowResult> {
    return await this.invoices.list(params);
  }

  /**
   * Get outstanding invoices
   */
  async outstandingInvoices(): Promise<WorkflowResult> {
    return await this.invoices.outstanding();
  }

  /**
   * Get overdue invoices
   */
  async overdueInvoices(): Promise<WorkflowResult> {
    return await this.invoices.overdue();
  }

  /**
   * Create a new invoice
   */
  async createInvoice(invoice: {
    contact: { name: string; email?: string; contactId?: string };
    lineItems: {
      description: string;
      quantity: number;
      unitAmount: number;
      accountCode: string;
      taxType?: string;
    }[];
    date?: string;
    dueDate?: string;
    reference?: string;
  }): Promise<WorkflowResult> {
    return await this.invoices.create(invoice);
  }

  /**
   * Duplicate an invoice
   */
  async duplicateInvoice(invoiceId: string): Promise<WorkflowResult> {
    return await this.invoices.duplicate(invoiceId);
  }

  /**
   * Email an invoice
   */
  async emailInvoice(params: {
    invoiceId: string;
    to: string;
    subject?: string;
    message?: string;
  }): Promise<WorkflowResult> {
    return await this.invoices.email(params);
  }

  /**
   * Authorize an invoice
   */
  async authorizeInvoice(invoiceId: string): Promise<WorkflowResult> {
    return await this.invoices.authorize(invoiceId);
  }

  /**
   * Mark invoice as paid
   */
  async markInvoicePaid(invoiceId: string): Promise<WorkflowResult> {
    return await this.invoices.markPaid(invoiceId);
  }

  // Budget Operations
  /**
   * Compare budget to actual
   */
  async compareBudget(params: {
    sheetId: string;
    sheetTab?: string;
    fromDate: string;
    toDate: string;
  }): Promise<WorkflowResult> {
    return await this.budget.compare(params);
  }

  /**
   * Get cash flow summary
   */
  async cashflow(days?: number): Promise<WorkflowResult> {
    return await this.budget.cashflow(days);
  }

  // Natural Language Router
  /**
   * Parse and execute natural language commands
   */
  async handleNaturalLanguage(query: string): Promise<WorkflowResult> {
    const q = query.toLowerCase();

    // P&L queries
    if (q.includes('p&l') || q.includes('profit') || q.includes('loss') || q.includes('income statement')) {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      return await this.getPnL({ month, year });
    }

    // Outstanding invoices
    if (q.includes('outstanding') || q.includes('unpaid') || q.includes('receivable')) {
      return await this.outstandingInvoices();
    }

    // Overdue invoices
    if (q.includes('overdue') || q.includes('late')) {
      return await this.overdueInvoices();
    }

    // Budget
    if (q.includes('budget')) {
      const now = new Date();
      const year = now.getFullYear();
      return await this.cashflow(30);
    }

    // Cash flow
    if (q.includes('cash flow') || q.includes('cashflow')) {
      return await this.cashflow(30);
    }

    // List invoices
    if (q.includes('invoice')) {
      return await this.listInvoices();
    }

    return {
      success: false,
      error: `Couldn't understand: "${query}". Try "show me my P&L", "any outstanding invoices?", "overdue invoices?", or "cash flow this month".`
    };
  }
}

// Export singleton factory for convenience
export function createXeroWorkflows(
  clientId: string,
  clientSecret: string,
  options?: {
    redirectUri?: string;
    tokenPath?: string;
    gogAccount?: string;
  }
): XeroWorkflows {
  return new XeroWorkflows(clientId, clientSecret, options);
}
