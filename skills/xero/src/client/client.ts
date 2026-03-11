/**
 * Xero Client Wrapper
 * Handles OAuth2, token refresh, and tenant management
 */

import { XeroClient } from 'xero-node';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { createServer, Server } from 'http';
import { URL } from 'url';
import type { XeroConfig, XeroTenant } from '../types/index.js';

export class XeroClientWrapper {
  private client: XeroClient;
  private config: XeroConfig;
  private tokenPath: string;
  private tenants: XeroTenant[] = [];
  
  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string = 'http://localhost:8080/callback',
    tokenPath: string = '/workspace/extra/credentials/xero-tokens.json'
  ) {
    this.config = {
      clientId,
      clientSecret,
      redirectUri,
      scopes: [
        'openid',
        'profile',
        'email',
        'accounting.transactions',
        'accounting.settings',
        'accounting.contacts',
        'offline_access'
      ]
    };
    this.tokenPath = tokenPath;
    
    this.client = new XeroClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUris: [this.config.redirectUri],
      scopes: this.config.scopes
    });
  }

  /**
   * Get the authorization URL for OAuth flow
   */
  async buildConsentUrl(): Promise<string> {
    return await this.client.buildConsentUrl();
  }

  /**
   * Handle the OAuth callback - exchange code for tokens
   */
  async handleCallback(code: string): Promise<void> {
    const tokenSet = await this.client.apiCallback(code);
    this.saveTokens(tokenSet);
    await this.updateTenants();
  }

  /**
   * Start OAuth flow with callback server
   */
  async authenticateWithServer(): Promise<void> {
    const consentUrl = await this.buildConsentUrl();
    console.log('🔐 Opening authorization URL...');
    console.log(consentUrl);
    
    // Try to open in browser
    const { exec } = await import('child_process');
    exec(`open "${consentUrl}"`);
    
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost:8080');
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');
          
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h1>Auth Error</h1><p>${error}</p>`);
            server.close();
            reject(new Error(error));
            return;
          }
          
          if (code) {
            await this.handleCallback(code);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <h1>✅ Authorized!</h1>
              <p>You can close this window and return to the terminal.</p>
              <script>setTimeout(() => window.close(), 2000)</script>
            `);
            server.close();
            resolve();
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>No code provided</h1>');
            server.close();
            reject(new Error('No code provided'));
          }
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error</h1><p>${err.message}</p>`);
          server.close();
          reject(err);
        }
      });
      
      server.listen(8080, () => {
        console.log('📡 Waiting for OAuth callback on http://localhost:8080/callback');
      });
    });
  }

  /**
   * Load tokens from file and initialize client
   */
  async initialize(): Promise<boolean> {
    const tokens = this.loadTokens();
    
    if (!tokens) {
      console.log('❌ No tokens found. Run authenticate() first.');
      return false;
    }
    
    await this.client.setTokenSet(tokens);
    await this.updateTenants();
    return true;
  }

  /**
   * Ensure we have valid tokens (refresh if needed)
   */
  private tokenSet: any = null;
  
  async ensureValidToken(): Promise<void> {
    const tokenSet = this.client.readTokenSet();
    if (!tokenSet) {
      throw new Error('No token set. Initialize first.');
    }
    
    // Check if token is expired (expires_in is seconds from issue time)
    // We check if there's less than 5 minutes left
    const expiresIn = tokenSet.expires_in;
    const tokenExpiry = tokenSet.issued_at + (expiresIn * 1000);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    if (tokenExpiry - now < fiveMinutes) {
      console.log('🔄 Token expired or expiring soon, refreshing...');
      try {
        const newTokens = await this.client.refreshToken();
        this.saveTokens(newTokens);
        await this.client.updateTenants();
        await this.updateTenants();
      } catch (err: any) {
        console.error('Token refresh failed:', err.message);
        throw err;
      }
    }
  }

  /**
   * Update tenant list
   */
  async updateTenants(): Promise<void> {
    await this.client.updateTenants();
    this.tenants = this.client.tenants.map(t => ({
      tenantId: t.tenantId,
      tenantName: t.tenantName || 'Unknown',
      tenantType: t.tenantType || 'UNKNOWN'
    }));
  }

  /**
   * Get current tenant
   */
  getTenant(): XeroTenant | null {
    return this.tenants[0] || null;
  }

  /**
   * Get all tenants
   */
  getTenants(): XeroTenant[] {
    return this.tenants;
  }

  /**
   * Save tokens to file
   */
  private saveTokens(tokens: any): void {
    const dir = dirname(this.tokenPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2));
    console.log('✅ Tokens saved to', this.tokenPath);
  }

  /**
   * Load tokens from file
   */
  private loadTokens(): any | null {
    if (existsSync(this.tokenPath)) {
      return JSON.parse(readFileSync(this.tokenPath, 'utf8'));
    }
    return null;
  }

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean {
    return this.tenants.length > 0;
  }

  // Expose the underlying xero-node client for direct API calls
  getApiClient(): XeroClient {
    return this.client;
  }
}
