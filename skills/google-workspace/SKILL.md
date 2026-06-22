---
name: google-workspace
description: Host-managed Google Workspace access for scripts and gws CLI. Uses read-only OAuth token files refreshed by the NanoClaw host — never refresh or write tokens from the container.
---

# google-workspace

Deterministic Google Workspace lane for NanoClaw: **host OAuth tokens** + **`gws` CLI** wrappers. Pair with MCP tools (`mcp__calendar__*`, `mcp__gmail__*`) for agent-driven ops.

## Accounts (registry ids)

| Registry id | Account | Token file |
|-------------|---------|------------|
| `shadow-google` | hello@connectedtutors.org | `shadow-google-token.json` |
| `meridian-google` | christina@meridian-institute.org | `meridian-google-token.json` |
| `google-gmail-legacy` | (Cleo legacy) | `google-gmail-token.json` |

Paths resolve under `/workspace/extra/credentials/` (container) or `~/.config/nanoclaw/credentials/services/` (host).

## gws wrappers (container)

```bash
# Connected Tutors
/workspace/extra/skills/google-workspace/bin/gws-ct drive files list --params '{"pageSize":5}'

# Meridian (after auth)
/workspace/extra/skills/google-workspace/bin/gws-meridian calendar events list --params '{"calendarId":"primary"}'
```

## Node lib (scripts / other skills)

```javascript
import { getAccessToken } from '../google-workspace/lib/access-token.mjs';
import { resolveGoogleCreds } from '../google-workspace/lib/resolve-google-creds.mjs';

const token = getAccessToken('shadow-google');
```

**Do not** refresh or write token JSON from containers. If expired: `ncl oauth-refresh-one --id shadow-google`.

## Send email (script)

```bash
node /workspace/extra/skills/google-workspace/bin/send-email.mjs \
  --registry shadow-google \
  --to tutor@example.com \
  --subject "Reminder" \
  --body "..."
```

Silas agents must confirm with Christina before send (see group `CLAUDE.local.md`).

## Auth (host, one-time / re-consent)

```bash
# Connected Tutors (full Workspace scopes)
sudo node skills/transcript-sync/scripts/auth-hello-ct-calendar.mjs

# Meridian personal
node skills/google-workspace/scripts/auth-hello-meridian-google.mjs
```

Add registry entries in `~/.config/nanoclaw/credentials/services/oauth-registry.json` and run `ncl oauth-refresh-one --id <id>`.

## Agent MCP vs scripts

| Task | Agent | Script |
|------|-------|--------|
| Calendar | `mcp__calendar__*` | `gws-ct calendar ...` |
| Gmail search/send | `mcp__gmail__*` | `send-email.mjs` / `gws-ct gmail ...` |
| Drive / Sheets / Docs | `gws-ct drive|sheets|docs ...` | same |
| Cron / batch | N/A | lib + gws |

Unified MCP evaluation: see [docs/WORKSPACE-MCP-SPIKE.md](docs/WORKSPACE-MCP-SPIKE.md) — **decision: keep calendar-mcp + gmail-mcp + gws** until Python `workspace-mcp` layer is justified.

## Install / deploy (Silas)

Run on `christina@cleo-lc` after merge:

```bash
scripts/silas/wire-google-workspace.sh
./container/build.sh
systemctl --user restart nanoclaw
pnpm run post-upgrade -- --agent silas --tier 1,2
```

See `.claude/skills/add-google-workspace-host/SKILL.md` for full wiring.
