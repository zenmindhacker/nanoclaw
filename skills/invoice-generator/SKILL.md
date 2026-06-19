---
name: invoice-generator
description: Generate Xero invoices from Toggl time entries and process NVS emails into Xero bills/invoices. Clients: Work Wranglers, CopperTeams, Ganttsy, Kevin Lee, NVS.
---

# Invoice Generator

Two tools for Xero billing:

1. **invoice-generator.mjs** — Monthly invoice preparation from Toggl hours
2. **nvs-processor.mjs** — Gmail email processing for NVS bills and invoices

## Invoice Preparation

```bash
node scripts/invoice-generator.mjs --client <name> --month <YYYY-MM>
```

Clients: `copperteams`, `ganttsy`, `work-wranglers`, `kevin-lee`, `nvs`, `all`

`--month` is the invoice month; hours come from the prior month.

## NVS Email Processor

```bash
node scripts/nvs-processor.mjs --flow ar|ap|all [--dry-run]
```

- **AR flow**: ar@newvaluegroup.com invoices -> Xero bills (ACCPAY) for Rustam's time
- **AP flow**: ap@newvaluegroup.com purchase orders -> Xero invoices (ACCREC)

Runs daily at 11am via scheduled task.

## Credentials

- Toggl: `~/.config/nanoclaw/credentials/services/toggl`
- Xero: `~/.config/nanoclaw/credentials/services/xero-tokens.json`
- Gmail: `~/.openclaw/credentials/google-gmail-token.json`

### Xero OAuth (host-owned)

The **host** refreshes `xero-tokens.json` every 15 minutes via `src/extensions/oauth/refresher.ts`.

- Before NVS runs: `ncl oauth-health` — if xero is `expired`/`error`, run `ncl oauth-refresh-one --id xero` on the host.
- **Do not** run `xero-auth.mjs` inside containers (read-only mount; wrong redirect URI).
- **Do not** patch scheduled tasks with `HTTPS_PROXY=''` — Xero API hosts are in `NO_PROXY` for OpenCode containers.
- Re-auth on the host only; update `oauth-registry.json` if paths change.

## Config

`scripts/config.json` — client rates, retainer hours, tax types, account codes, NVS processing rules.
