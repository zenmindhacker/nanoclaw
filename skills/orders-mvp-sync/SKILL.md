---
name: orders-mvp-sync
description: Run Connected Tutors orders-mvp pipeline sync (GA orders, Odyssey fulfill, cases, roster) and report deltas/errors to #ai-bot. Used by Silas scheduled task.
---

# orders-mvp-sync

Agent-invoked helper for the Connected Tutors Master Tracker pipeline. **Not** a NanoClaw pre-task `wakeAgent` script (full sync exceeds the 30s pre-script timeout).

## Run

```bash
bash /workspace/extra/skills/orders-mvp-sync/scripts/run-sync.sh
```

Welcome email + Quo SMS run by default (`sync_welcome`). Use `--skip-welcome` only as an emergency bypass if Cian asks.

### Friday tutor TW completion reminders

Scheduled Fridays 16:00 ET (`orders-mvp-tutor-tw-reminders`, NanoClaw v2). Wrapper:

```bash
bash /workspace/extra/skills/orders-mvp-sync/scripts/run-tutor-completion-reminders.sh
```

Refreshes Master Tracker `TW Lessons`, then emails each tutor (hello@) past incomplete TW lessons with the [Complete Lessons](https://intercom.help/teachworks-e2d272c6e669/en/articles/11472097-completing-lessons) help link.

Receipt PDFs need **pandoc** + **chromium** in the Silas container (`ncl groups config add-package --apt pandoc` + rebuild). Chromium uses `--no-sandbox` automatically under Docker.

**Single-flight:** `run-sync.sh` writes a shared run id + takes a flock on the repo mount. A new run preempts lingering ones — older `sync_all` processes exit at the next step with `[SUPERSEDED]` (not an error).

## Code ownership / sync

| What | Repo | Path |
|------|------|------|
| Pipeline (`sync_all`, welcome, Odyssey, …) | `connected-tutoring` | `orders-mvp/` |
| This wrapper + skill docs | `nanoclaw` | `skills/orders-mvp-sync/` |
| Schedule prompt | `nanoclaw` | `scripts/scheduled-tasks.manifest.json` (+ live task patch) |

`run-sync.sh` pulls **connected-tutoring** before each run. Edits to this skill require a **nanoclaw** commit + push (host `~/nanoclaw` / laptop clone) — do not leave host-only skill patches. Full git rules: agent `CLAUDE.md` → Git Repos.

## What it does

1. `git pull --ff-only` on `/workspace/extra/repos/connected-tutoring`
2. Exports Google CLI env (`CT_SHEETS_CT`, `CT_DRIVE_CT`, `CT_SEND_EMAIL`, `CT_GOOGLE_REGISTRY=shadow-google`, …)
3. Loads host credential files (`quo.api_key` required, `esignatures-cognitive` / CTCI account, TeachWorks)
4. Requires repo `.env` with `GA_ODYSSEY_USERNAME` / `GA_ODYSSEY_PASSWORD`
5. Runs `python3 sync_all.py` (welcome ON)

## After run

Parse stdout for `--- PIPELINE_REPORT ---` JSON.

**Default: silent.** Post to **#ai-bot** (`to: "ai-bot"`) only for NEW deltas or errors. Full step/count rundown only when Cian asks.

| Post | Skip |
|------|------|
| Failures / degraded (failed step + safe remediations) | Inventory totals (“31 rows”, “53 entitlements”) |
| GA **appends** (new orders) | Updated/unchanged sheet refreshes |
| Odyssey fulfillments > 0 | “folders skipped (already exist)” |
| New student Info docs / new onboarding folders | Attendance/roster rollups on a clean run |
| Welcome email/SMS sends | “all green” / one-line OK chatter |

## Host secrets (christina@cleo-lc)

| File under `~/.config/nanoclaw/credentials/services/` | Env |
|-------------------------------------------------------|-----|
| (Google) `shadow-google-token.json` | host OAuth |
| `quo.api_key` | `QUO_API_KEY` |
| `esignatures-cognitive` (CTCI shared account) | `ESIGNATURES_API_TOKEN` |
| `teachworks.api_key` | `TEACHWORKS_API_KEY` |
| `teachworks.web_email` / `teachworks.web_password` | TW web login |
| Repo `~/repos/connected-tutoring/.env` | `GA_ODYSSEY_*` |

## Scheduled task

NanoClaw v2 native — `orders-mvp-sync` in `scripts/scheduled-tasks.manifest.json`, `script: null`, recurrence `0 7,12,15,18 * * *` (America/New_York host TZ).
