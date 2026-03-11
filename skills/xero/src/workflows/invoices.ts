/**
 * Invoice Workflow
 * - List outstanding invoices
 * - Create new invoices
 * - Duplicate invoices
 * - Send invoices via email
 */

import { Invoice } from 'xero-node';
import type { XeroClientWrapper } from '../client/client.js';
import type { 
  WorkflowResult, 
  InvoiceListParams, 
  InvoiceCreateParams,
  InvoiceEmailParams 
} from '../types/index.js';

export class InvoiceWorkflow {
  constructor(private xero: XeroClientWrapper) {}

  /**
   * List invoices with optional filters
   */
  async list(params: InvoiceListParams = {}): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();
      
      // Build query params
      let where = '';
      if (params.status) {
        where = `Status=="${params.status}"`;
      }
      if (params.contactId) {
        where += where ? ` AND Contact.ContactID=="${params.contactId}"` : `Contact.ContactID=="${params.contactId}"`;
      }
      if (params.dueDate) {
        where += where ? ` AND DueDate=="${params.dueDate}"` : `DueDate=="${params.dueDate}"`;
      }

      const response = await api.getInvoices(
        tenant.tenantId,
        undefined, // modifiedSince
        where || undefined,
        undefined, // order
        undefined, // page
        undefined  // unitdp
      );

      const invoices = response.body.invoices || [];
      
      return {
        success: true,
        data: invoices,
        formatted: this.formatInvoiceList(invoices, params.status)
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to list invoices'
      };
    }
  }

  /**
   * Get outstanding (unpaid) invoices
   */
  async outstanding(since?: string): Promise<WorkflowResult> {
    return this.list({ status: 'AUTHORISED' });
  }

  /**
   * Get overdue invoices
   */
  async overdue(): Promise<WorkflowResult> {
    try {
      const result = await this.list({ status: 'AUTHORISED' });
      if (!result.success || !result.data) {
        return result;
      }

      const today = new Date().toISOString().split('T')[0];
      const overdue = result.data.filter((inv: any) => 
        inv.dueDate && inv.dueDate < today
      );

      return {
        success: true,
        data: overdue,
        formatted: this.formatInvoiceList(overdue, 'OVERDUE')
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a new invoice
   */
  async create(params: InvoiceCreateParams): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();

      // First, find or create the contact
      let contactId = params.contact?.contactId;
      
      if (!contactId && params.contact?.name) {
        // Search for existing contact
        const contactsResponse = await api.getContacts(
          tenant.tenantId,
          undefined,
          `Name=="${params.contact.name}"`
        );
        
        if (contactsResponse.body.contacts?.length > 0) {
          contactId = contactsResponse.body.contacts[0].contactID;
        } else {
          // Create new contact
          const newContact = await api.createContacts(
            tenant.tenantId,
            { contacts: [{ name: params.contact.name, email: params.contact.email }] }
          );
          contactId = newContact.body.contacts[0].contactID;
        }
      }

      const today = new Date().toISOString().split('T')[0];
      const dueDate = params.dueDate || this.addDays(today, 30);

      const invoiceData = {
        invoices: [{
          type: Invoice.TypeEnum.ACCREC, // Accounts Receivable
          contact: { contactID: contactId },
          lineItems: params.lineItems.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitAmount: item.unitAmount,
            accountCode: item.accountCode,
            taxType: item.taxType || 'NONE'
          })),
          date: params.date || today,
          dueDate: dueDate,
          reference: params.reference || '',
          status: Invoice.StatusEnum.DRAFT
        }]
      };

      const response = await api.createInvoices(tenant.tenantId, invoiceData);
      const created = response.body.invoices?.[0];

      return {
        success: true,
        data: created,
        formatted: `✅ Created invoice ${created?.invoiceNumber || 'N/A'}\n` +
          `   Contact: ${params.contact.name}\n` +
          `   Amount: $${this.calculateTotal(params.lineItems)}\n` +
          `   Due: ${dueDate}\n` +
          `   Status: DRAFT (use 'send' to email or 'authorize' to approve)`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create invoice'
      };
    }
  }

  /**
   * Duplicate an existing invoice
   */
  async duplicate(invoiceId: string): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();
      
      // Get the original invoice
      const original = await api.getInvoice(tenant.tenantId, invoiceId);
      const inv = original.body.invoices?.[0];

      if (!inv) {
        return { success: false, error: 'Invoice not found' };
      }

      // Create a duplicate
      const today = new Date().toISOString().split('T')[0];
      const dueDate = this.addDays(today, 30);

      const duplicateData = {
        invoices: [{
          type: inv.type,
          contact: inv.contact,
          lineItems: inv.lineItems?.map((item: any) => ({
            description: item.description,
            quantity: item.quantity,
            unitAmount: item.unitAmount,
            accountCode: item.accountCode,
            taxType: item.taxType
          })),
          date: today,
          dueDate: dueDate,
          reference: `${inv.reference} (Copy)`,
          status: Invoice.StatusEnum.DRAFT
        }]
      };

      const response = await api.createInvoices(tenant.tenantId, duplicateData);
      const created = response.body.invoices?.[0];

      return {
        success: true,
        data: created,
        formatted: `✅ Duplicated invoice ${inv.invoiceNumber} → ${created?.invoiceNumber || 'N/A'}\n` +
          `   New invoice is in DRAFT status`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to duplicate invoice'
      };
    }
  }

  /**
   * Email an invoice to a contact
   */
  async email(params: InvoiceEmailParams): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();
      
      // First get the invoice to make sure it exists and is authorized
      const invoice = await api.getInvoice(tenant.tenantId, params.invoiceId);
      const inv = invoice.body.invoices?.[0];

      if (!inv) {
        return { success: false, error: 'Invoice not found' };
      }

      if (inv.status !== Invoice.StatusEnum.AUTHORISED) {
        return { 
          success: false, 
          error: `Invoice must be AUTHORISED to send. Current status: ${inv.status}` 
        };
      }

      // Use Xero's built-in email or send via Gmail
      // For now, we'll construct an email and use gog to send it
      const emailBody = this.formatInvoiceEmail(inv, params);
      
      return {
        success: true,
        data: { invoice: inv, emailParams: emailBody },
        formatted: `📧 Invoice ${inv.invoiceNumber} ready to email to ${params.to}\n\n` +
          `Subject: ${emailBody.subject}\n\n` +
          `Use 'gog gmail send' to send this email.`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to prepare invoice email'
      };
    }
  }

  /**
   * Authorize (approve) an invoice
   */
  async authorize(invoiceId: string): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();
      
      // Get the invoice
      const invoice = await api.getInvoice(tenant.tenantId, invoiceId);
      const inv = invoice.body.invoices?.[0];

      if (!inv) {
        return { success: false, error: 'Invoice not found' };
      }

      // Update to AUTHORISED status
      const response = await api.updateInvoice(
        tenant.tenantId,
        inv.invoiceID!,
        {
          invoices: [{
            ...inv,
            status: Invoice.StatusEnum.AUTHORISED
          }]
        }
      );

      const updated = response.body.invoices?.[0];

      return {
        success: true,
        data: updated,
        formatted: `✅ Invoice ${updated?.invoiceNumber} AUTHORISED\n` +
          `   Now ready to send or mark as paid`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to authorize invoice'
      };
    }
  }

  /**
   * Mark invoice as paid
   */
  async markPaid(invoiceId: string): Promise<WorkflowResult> {
    try {
      await this.xero.ensureValidToken();
      
      const tenant = this.xero.getTenant();
      if (!tenant) {
        return { success: false, error: 'No tenant connected' };
      }

      const api = this.xero.getApiClient();
      
      // Get the invoice
      const invoice = await api.getInvoice(tenant.tenantId, invoiceId);
      const inv = invoice.body.invoices?.[0];

      if (!inv) {
        return { success: false, error: 'Invoice not found' };
      }

      // Create a payment for the invoice
      // This is more complex - for now just return info
      return {
        success: true,
        data: inv,
        formatted: `ℹ️  Invoice ${inv.invoiceNumber}\n` +
          `   Current status: ${inv.status}\n` +
          `   Amount: $${inv.total}\n` +
          `   To mark as paid, you need to create a payment against this invoice.`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to mark invoice as paid'
      };
    }
  }

  // Helper methods
  private formatInvoiceList(invoices: any[], filter?: string): string {
    if (invoices.length === 0) {
      return filter === 'OVERDUE' 
        ? '✅ No overdue invoices!' 
        : '📭 No invoices found';
    }

    const lines: string[] = [];
    lines.push(`📋 ${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`);
    if (filter === 'OVERDUE') lines.push('⚠️  OVERDUE');
    else if (filter) lines.push(`Status: ${filter}`);
    lines.push('');

    let totalOutstanding = 0;

    for (const inv of invoices) {
      const status = this.getStatusEmoji(inv.status);
      const amount = parseFloat(inv.total || '0');
      totalOutstanding += amount;
      
      lines.push(`${status} ${inv.invoiceNumber || 'N/A'}`);
      lines.push(`   ${inv.contact?.name || 'Unknown'}`);
      lines.push(`   $${amount.toFixed(2)} • Due: ${inv.dueDate || 'N/A'}`);
      if (inv.reference) lines.push(`   Ref: ${inv.reference}`);
      lines.push('');
    }

    lines.push(`💰 Total: $${totalOutstanding.toFixed(2)}`);
    
    return lines.join('\n');
  }

  private getStatusEmoji(status: string): string {
    const map: Record<string, string> = {
      DRAFT: '📝',
      SUBMITTED: '📤',
      AUTHORISED: '✅',
      PAID: '💵',
      VOIDED: '🚫',
      DELETED: '🗑️'
    };
    return map[status] || '❓';
  }

  private calculateTotal(lineItems: any[]): string {
    const total = lineItems.reduce((sum, item) => {
      return sum + (item.quantity * item.unitAmount);
    }, 0);
    return total.toFixed(2);
  }

  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  private formatInvoiceEmail(inv: any, params: InvoiceEmailParams): { subject: string; body: string } {
    const subject = params.subject || `Invoice ${inv.invoiceNumber} from Cognitive Technology Consulting`;
    const body = params.message || `
Dear ${inv.contact?.name},

Please find attached invoice ${inv.invoiceNumber}.

Amount: $${inv.total}
Due Date: ${inv.dueDate}

Payment details:
Bank: TD Canada Trust
Account: Cognitive Technology Consulting Inc.
Account #: [to be added]

Thank you for your business!

Best regards,
Cian
Cognitive Technology Consulting Inc.
`;
    return { subject, body };
  }
}
