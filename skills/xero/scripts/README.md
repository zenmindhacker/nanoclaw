# Xero API Test Script

## Run

```bash
cd ~/.openclaw/workspace/xero-test
node xero-test.js
```

1. If no tokens or expired: Follow prompts to authorize (visit URL, copy callback URL).
2. Tokens saved to `~/.openclaw/credentials/xero-tokens.json`
3. Tests Organisation, Accounts, ProfitAndLoss report endpoints.
4. Handles token refresh automatically.

**Note:** ProfitAndLoss for 2025 dates may be empty (future period).

## Delete Tokens (to re-auth)

```bash
rm ~/.openclaw/credentials/xero-tokens.json
```

Built with Node.js built-ins only (no deps).
