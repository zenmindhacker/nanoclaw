/**
 * Xero Workflows - Type Definitions
 */

export interface XeroConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface WorkflowResult {
  success: boolean;
  data?: any;
  error?: string;
  formatted?: string;
}

export interface WorkflowParams {
  [key: string]: any;
}

export interface PnLParams {
  fromDate?: string;  // YYYY-MM-DD
  toDate?: string;    // YYYY-MM-DD
  month?: number;     // 1-12
  year?: number;
}

export interface InvoiceListParams {
  status?: 'DRAFT' | 'SUBMITTED' | 'AUTHORISED' | 'PAID' | 'VOIDED' | 'DELETED';
  dueDate?: string;
  contactId?: string;
  since?: string;
}

export interface InvoiceCreateParams {
  contact: {
    name: string;
    email?: string;
    contactId?: string;
  };
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
  notes?: string;
}

export interface InvoiceEmailParams {
  invoiceId: string;
  to: string;
  subject?: string;
  message?: string;
}

export interface BudgetCompareParams {
  sheetId: string;
  sheetTab?: string;
  fromDate: string;
  toDate: string;
}

export interface XeroTenant {
  tenantId: string;
  tenantName: string;
  tenantType: string;
}
