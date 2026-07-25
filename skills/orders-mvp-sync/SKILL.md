---
name: orders-mvp-sync
description: Run Connected Tutors orders-mvp pipeline sync (GA orders, Odyssey fulfill, cases, roster) and report to #sysops. Used by Silas scheduled task.
---

# orders-mvp-sync

Agent-invoked helper for the Connected Tutors Master Tracker pipeline. **Not** a NanoClaw pre-task `wakeAgent` script (full sync exceeds the 30s pre-script timeout).

## Run

```bash
bash /workspace/extra/skills/orders-mvp-sync/scripts/run-sync.sh
```

Phase 1 always passes `--skip-welcome`. Do not re-run with welcome unless Cian asks.

## What it does

1. `git pull --ff-only` on `/workspace/extra/repos/connected-tutoring`
2. Exports Google CLI env (`CT_SHEETS_CT`, `CT_DRIVE_CT`, `CT_GOOGLE_REGISTRY=shadow-google`, …)
3. Loads optional host credential files (`quo.api_key`, `esignatures-tutoring`, TeachWorks)
4. Requires repo `.env` with `GA_ODYSSEY_USERNAME` / `GA_ODYSSEY_PASSWORD`
5. Runs `python3 sync_all.py --skip-welcome`

## After run

Parse stdout for `--- PIPELINE_REPORT ---` JSON. Post to **#sysops**:

- Failures first + failed step + safe remediations (oauth-health, re-pull, one retry if clearly transient)
- Meaningful changes (GA append/update, fulfillments, roster)
- One-line OK when nothing changed

## Host secrets (christina@cleo-lc)

| File under `~/.config/nanoclaw/credentials/services/` | Env |
|-------------------------------------------------------|-----|
| (Google) `shadow-google-token.json` | host OAuth |
| `quo.api_key` | `QUO_API_KEY` |
| `esignatures-tutoring` | `ESIGNATURES_API_TOKEN` |
| `teachworks.api_key` | `TEACHWORKS_API_KEY` |
| `teachworks.web_email` / `teachworks.web_password` | TW web login |
| Repo `~/repos/connected-tutoring/.env` | `GA_ODYSSEY_*` |

## Scheduled task

NanoClaw v2 native — `orders-mvp-sync` in `scripts/scheduled-tasks.manifest.json`, `script: null`, recurrence `0 11,16,19,22 * * *` (UTC on Silas host ≈ 7am / 12pm / 3pm / 6pm America/New_York during EDT).
