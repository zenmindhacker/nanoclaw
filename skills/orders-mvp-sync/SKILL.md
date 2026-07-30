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
3. Loads host credential files (`quo.api_key` required, `esignatures-cognitive` / CTCI account, TeachWorks, per-platform `odyssey.*`)
4. Requires at least one Odyssey platform credential pair under `credentials/services/` (e.g. `odyssey.ga.username` + `odyssey.ga.password`)
5. Runs `python3 sync_all.py` (welcome ON)

## After run

Parse stdout for `--- PIPELINE_REPORT ---` JSON (and any traceback / `Warning:` lines above it).

Always post to **#ai-bot** (`to: "ai-bot"`). Full step/count rundown only when Cian asks.

| Post | Skip |
|------|------|
| Clean / no NEW: exactly one line — `Ran the CT sync: Nothing to report` | Inventory totals (“31 rows”, “53 entitlements”) |
| Failures / degraded (analyze + recommend — see below) | Updated/unchanged sheet refresh counts |
| GA **appends** (new orders) | “folders skipped (already exist)” |
| Odyssey fulfillments > 0 | Attendance/roster rollups on a clean run |
| New student Info docs / new onboarding folders | Multi-line “all green” rundowns |
| Welcome email/SMS sends | Extra chatter in the wake DM beyond the #ai-bot post |

## Diagnose & recommend (do not auto-fix)

On `status: "degraded"` / `"failed"`, or a hard traceback that aborted the run:

1. Name the failed/warn **step** and quote the short `detail` / stderr (trim stack noise).
2. Match against the playbook below.
3. Post to **#ai-bot**: what happened → impact (blocking vs cosmetic) → **recommended fix for Cian** (concrete command or file to change).
4. **Do not** apply the fix yourself unless Cian explicitly asks. That means: no editing `connected-tutoring` / this skill on the host, no `install_packages`, no secret edits, no Odyssey re-fulfill, no “silent” code patches.
5. **Allowed without asking:** report git HEAD of the repo mount; one retry of `run-sync.sh` only if the playbook says the failure is clearly transient (proxy timeout / 5xx); `oauth-health` style read-only checks if available.
6. **Skill gap:** if a failure mode is not in this playbook, still recommend a fix — and append a short proposed SKILL.md snippet (playbook row) in the same #ai-bot post so Cian can merge it into nanoclaw. Do not write that snippet onto the host skill yourself.

### Playbook

| Signal (stdout / step detail) | Likely meaning | Recommend to Cian |
|------------------------------|----------------|-------------------|
| `[SUPERSEDED]` | Newer sync preempted this run (single-flight) | Ignore — not an error |
| `status formatting not applied` / `Roster meta fetch failed` / `Roster meta JSON parse failed` | Roster **rows** wrote; conditional-format pass failed (Sheets meta/proxy glitch). Cosmetic | Note degraded. If it repeats after next pull: check OneCLI/Google proxy; pipeline harden lives in `orders-mvp/build_roster.py` `_apply_status_formatting` |
| `TypeError: … meta …` / `Cannot read properties of undefined (reading 'sheets')` during formatting | Same path as above; old code lacked HTTP/JSON guards | Confirm `connected-tutoring` pulled latest `main`; if still after pull, escalate with full Warning line |
| `pandoc: not found` / receipt PDF / welcome HTML→PDF | Container missing pandoc | `ncl groups config add-package --apt pandoc` for Silas group + rebuild (do not invent other packages) |
| Chromium / `No usable sandbox` / PDF render fail | Browser sandbox under Docker | Code should pass `--no-sandbox` in `orders-mvp/orders_mvp/receipt_pdf.py`; if missing on pulled HEAD, recommend that patch |
| Missing `QUO_API_KEY` / Quo SMS fail | Host secret | Ensure `~/.config/nanoclaw/credentials/services/quo.api_key` mounted into env for the wrapper |
| `ESIGNATURES` / eSignatures auth | Host secret | `esignatures-cognitive` (CTCI) under credentials/services |
| `TEACHWORKS` / 401 from TW | Host secret or stale key | `teachworks.api_key` (+ web email/password if web path) |
| Odyssey login fail / missing platform creds | Host secret | Add `odyssey.<id>.username` + `odyssey.<id>.password` under `credentials/services/` (no SSO; each state different password). Legacy TX/UT use `admin@conscioustutoring.com` until hello@ accounts are approved. |
| `invalid_grant` / 401 Google / sheets fetch unauthorized | OAuth token | Re-auth / refresh `shadow-google` host token; do not paste tokens into Slack |
| flock / “another sync” / long overlap | Concurrent runners | Wait for next schedule slot; if stuck, ask Cian before killing processes |
| Welcome send fail for one student | Per-student email/SMS/PDF | Include student name + error; do **not** re-send all welcomes |
| Step `error` + non-optional | Hard pipeline failure | Stop after recommend; do not invent sheet/Odyssey state |

### #ai-bot error post shape

Keep it short:

```
orders-mvp: degraded — build_roster (cosmetic)
• Warning: status formatting not applied (Roster meta fetch failed HTTP 502: …)
• Impact: Roster rows OK; colors/notes may be stale
• Recommend: no action if one-off; if repeats, check Google/OneCLI proxy / pull latest build_roster harden
```

## Host secrets (christina@cleo-lc)

| File under `~/.config/nanoclaw/credentials/services/` | Env |
|-------------------------------------------------------|-----|
| (Google) `shadow-google-token.json` | host OAuth |
| `quo.api_key` | `QUO_API_KEY` |
| `esignatures-cognitive` (CTCI shared account) | `ESIGNATURES_API_TOKEN` |
| `teachworks.api_key` | `TEACHWORKS_API_KEY` |
| `teachworks.web_email` / `teachworks.web_password` | TW web login |
| `odyssey.ga.username` / `odyssey.ga.password` | `GA_ODYSSEY_*` |
| `odyssey.ga_new.*` / `odyssey.ut.*` / `odyssey.tx.*` / `odyssey.wy.*` / `odyssey.mo.*` / `odyssey.la.*` | Matching `*_ODYSSEY_*` env pairs |

## Scheduled task

NanoClaw v2 native — `orders-mvp-sync` in `scripts/scheduled-tasks.manifest.json`, `script: null`, recurrence `0 7,12,15,18 * * *` (America/New_York host TZ).
