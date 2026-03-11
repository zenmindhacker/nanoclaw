# Invoice Generator Skill

Generates Xero invoices from Toggl time entries for monthly client billing.

## Overview

This skill creates draft invoices in Xero based on hours tracked in Toggl. It supports multiple clients with different billing logic:

- **Work Wranglers** - Hours by team member (Cian + Rustam)
- **CopperTeams (Kora MVP)** - Retainer + excess hours
- **Ganttsy (Ganttsy MVP)** - Retainer + excess hours  
- **Kevin Lee** - Fixed weekly retainer (copied from prior month)
- **New Value Solutions** - Fixed monthly amount (copied from prior month)

## Usage

```bash
# Generate invoice for a specific client
node ~/.openclaw/workspace/skills/invoice-generator/scripts/invoice-generator.mjs \
  --client copperteams \
  --month 2026-02

# Generate invoices for all clients
node ~/.openclaw/workspace/skills/invoice-generator/scripts/invoice-generator.mjs \
  --client all \
  --month 2026-02

# Available clients:
# - copperteams
# - ganttsy
# - work-wranglers
# - kevin-lee
# - nvs
# - all
```

## How It Works

### Date Logic
- The `--month` parameter specifies the **invoice month** (e.g., March 2026)
- Hours are pulled from **the prior month** (e.g., February 2026 for March invoice)
- This matches the billing cycle: bill for last month's work

### Billing Logic by Client

**Work Wranglers:**
- Fetches hours from Toggl for project "WW: Consulting" (project_id: 204851981)
- Separates hours by user (Cian vs Rustam)
- Creates line items at $150/hour (configurable in config.json)
- If Cian has 0 hours, keeps line item at 0 qty

**CopperTeams (Kora MVP):**
- Prior month's retainer: 11 hours @ $275/hr = $3,025
- Fetches current month hours from Toggl project 214367650
- If hours > 11, bills excess at $225/hour
- Retainer line item stays fixed at 11 hours

**Ganttsy (Ganttsy MVP):**
- Prior month's retainer: 40 hours @ $225/hr = $9,000
- Fetches current month hours from Toggl project 215944745
- If hours > 40, bills excess at $225/hour
- Retainer line item stays fixed at 40 hours

**Kevin Lee:**
- Copies prior month's invoice exactly
- Fixed: 1 hour @ $1,400 = $1,400
- No Toggl data used

**New Value Solutions:**
- Copies prior month's invoice exactly
- Fixed: $661.50
- Uses TAX002 (different tax type!) and account code 311

### Tax & Account Codes

| Client | Tax Type | Account Code |
|--------|----------|--------------|
| Work Wranglers | TAX001 (5% BC GST) | 200 |
| CopperTeams | TAX001 | 200 |
| Ganttsy | TAX001 | 200 |
| Kevin Lee | TAX001 | 200 |
| NVS | TAX002 | 311 |

## File Structure

```
~/.openclaw/workspace/skills/invoice-generator/
├── SKILL.md                    # This file
└── scripts/
    ├── invoice-generator.mjs   # Main script
    ├── toggl-helpers.mjs       # Toggl API calls
    ├── xero-helpers.mjs        # Xero API calls
    └── config.json             # Configuration
```

## Configuration

Edit `scripts/config.json` to adjust:

- **Rates**: Retainer rates, excess rates per client
- **Retainer hours**: Monthly retainer quantities
- **Tax types**: TAX001 (BC GST 5%) or TAX002
- **Account codes**: Revenue account codes in Xero

## Credentials

- **Toggl**: `~/.openclaw/credentials/toggl` - API token
- **Xero**: `~/.openclaw/credentials/xero-tokens.json` - OAuth2 tokens

## Error Handling

- Token refresh: Automatic when tokens expire
- Missing Toggl data: Returns 0 hours, continues with invoice
- Draft cleanup: Deletes existing draft invoices before creating new ones
- Validation: Tests Xero connection before creating invoices

## Examples

```bash
# Generate CopperTeams invoice for March 2026 (uses Feb hours)
node scripts/invoice-generator.mjs --client copperteams --month 2026-03

# Generate all invoices for February 2026
node scripts/invoice-generator.mjs --client all --month 2026-02
```

## Dependencies

- xero-node (npm package)
- Node.js 18+
