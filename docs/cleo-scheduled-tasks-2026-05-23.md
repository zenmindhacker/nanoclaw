# Cleo Scheduled Tasks Snapshot

Captured on 2026-05-23 before temporarily deleting Cleo's pending scheduled tasks for the ghost 401 isolation test.

The rows were pending in Cleo's v2 session `inbound.db` files. Times are UTC.

## Current Status

Updated 2026-05-23 after re-enabling `oauth-health-check` through NanoClaw's scheduling module API (`insertTask()`), not direct SQLite row insertion.

| Name | Status | Current live task id | Next run | Notes |
|---|---|---|---|---|
| oauth-health-check | active | `oauth-health-check` | `2026-05-23T17:00:00.000Z`, then hourly | Read-only gate script; wakes the agent only for expired/error OAuth state. |
| transcript-sync | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| nvs-email-processor | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| catch-up-auditor | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| transcript-unmatched-reminder | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| pending-actions-reminder | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| transcript sync pipeline (thread copy) | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| weekly coaching transcript audit | inactive | none | n/a | Disabled during ghost 401 isolation test. |
| pending actions / follow-ups check | inactive | none | n/a | Disabled during ghost 401 isolation test. |

## Summary

| Name | Schedule | Next run at capture | Session | Destination |
|---|---:|---|---|---|
| transcript-sync | `10,25,40,55 * * * *` | `2026-05-23T16:25:00.000Z` | `sess-1779305793654-nnzhoi` | `slack:C07F195GB96` |
| nvs-email-processor | `0 11 * * *` | `2026-05-23T17:00:00.000Z` | `sess-1779305793654-nnzhoi` | `slack:C07F195GB96` |
| catch-up-auditor | `0 7-21 * * *` | `2026-05-23T17:00:00.000Z` | `sess-1779305793654-nnzhoi` | `slack:C07F195GB96` |
| oauth-health-check | `0 */1 * * *` | `2026-05-23T17:00:00.000Z` | `sess-1779305793654-nnzhoi` | none |
| transcript-unmatched-reminder | `0 13,18 * * 1-5` | `2026-05-25T19:00:00.000Z` | `sess-1779305793654-nnzhoi` | `slack:C07F195GB96` |
| pending-actions-reminder | `0 9,14 * * 1-5` | `2026-05-25T15:00:00.000Z` | `sess-1779305793767-0x3tru` | `slack:C07F195GB96` |
| transcript sync pipeline (thread copy) | `*/30 * * * *` | `2026-05-23T16:30:00.000Z` | `sess-1779305793858-kk8oo8` | `slack:C07F195GB96:t:1776188967.527459` |
| weekly coaching transcript audit | `0 9 * * 1` | `2026-05-25T15:00:00.000Z` | `sess-1779305793858-kk8oo8` | `slack:C07F195GB96:t:1776188967.527459` |
| pending actions / follow-ups check | `0 10,14 * * 1-5` | `2026-05-25T16:00:00.000Z` | `sess-1779305793858-kk8oo8` | `slack:C07F195GB96:t:1776188967.527459` |

## Task Details

### transcript-sync

- Row id: `task-1779552648529-170h5v`
- Series id: `transcript-sync`
- DB: `data/v2-sessions/ag-1779305793650-yffcyh/sess-1779305793654-nnzhoi/inbound.db`
- Schedule: `10,25,40,55 * * * *`
- Prompt: report transcript sync results to `#sysops` when files are written or push errors occur; stay silent when no files and no errors.
- Script: embedded bash gate.

Script behavior:

- Verifies `python3` and `git` are present.
- Copies Shadow DB to `/tmp` so SQLite WAL files are writable.
- Refreshes Google OAuth tokens for `shadow-google`, `ganttsy-google`, and `google-gmail` if they are close to expiry.
- Installs transcript-sync npm dependencies if missing.
- Runs `tsx transcript-sync.ts --tasks-mode auto --calendar-window-minutes 60`.
- Stores current unmatched transcript state in `skills/transcript-sync/.unmatched.json`.
- Does not wake the agent for unmatched-only or no-op runs.
- Commits written transcript files and attempts to push them to their repo remotes using `/workspace/extra/credentials/github-transcript-token`.
- Wakes the agent with a JSON payload only when files were written, push errors occurred, or a fatal/parse error happened.

### nvs-email-processor

- Row id: `task-1779469258924-ydy73w`
- Series id: `nvs-email-processor`
- DB: `data/v2-sessions/ag-1779305793650-yffcyh/sess-1779305793654-nnzhoi/inbound.db`
- Schedule: `0 11 * * *`
- Prompt: process New Value Solutions AR/AP emails and create corresponding Xero bills/invoices.
- Script/command from prompt:

```bash
cd /workspace/extra/skills/invoice-generator && node scripts/nvs-processor.mjs --flow all
```

Script behavior:

- Reads NVS-related email data through the invoice-generator skill.
- Runs both AR and AP processing flows.
- Creates Xero invoice/bill artifacts when new valid messages are found.
- Reports material results or decisions needed.

### catch-up-auditor

- Row id: `task-1779552048273-6ceeq4`
- Series id: `catch-up-auditor`
- DB: `data/v2-sessions/ag-1779305793650-yffcyh/sess-1779305793654-nnzhoi/inbound.db`
- Schedule: `0 7-21 * * *`
- Prompt: if scheduled tasks missed their expected daily window, re-run them now.
- Script: embedded bash gate.

Script behavior:

- Reads the task snapshot available to the scheduled agent.
- Checks daily tasks whose scheduled time has passed by at least 30 minutes.
- Skips high-frequency schedules such as `*/30` or comma/range-heavy schedules.
- Wakes the agent only when it detects missed tasks.
- Provides the missed task ids and suggested re-run commands in script data.

### oauth-health-check

- Row id: `task-1779552048305-hk2nrr`
- Series id: `oauth-health-check`
- DB: `data/v2-sessions/ag-1779305793650-yffcyh/sess-1779305793654-nnzhoi/inbound.db`
- Schedule: `0 */1 * * *`
- Prompt: run read-only OAuth health checks; alert `#sysops` only for real expired/error states or failed refreshes.
- Script:

```bash
bash /workspace/agent/oauth-health-gate.sh
```

Script behavior:

- Runs the local OAuth health gate from the scheduled agent group.
- Keeps the host process as the owner of token refresh.
- Should stay silent when tokens are merely short-lived or expiring normally.
- Wakes the agent only when health output indicates expired/error tokens or refresh failures.

### transcript-unmatched-reminder

- Row id: `task-1779494492993-xhc6ib`
- Series id: `transcript-unmatched-reminder`
- DB: `data/v2-sessions/ag-1779305793650-yffcyh/sess-1779305793654-nnzhoi/inbound.db`
- Schedule: `0 13,18 * * 1-5`
- Prompt: post a concise `#sysops` reminder listing Shadow recordings that transcript-sync could not classify.
- Script: embedded bash gate.

Script behavior:

- Reads `/workspace/extra/skills/transcript-sync/.unmatched.json`.
- Stays silent if the file is missing or the `unmatched` list is empty.
- Wakes the agent with the unmatched list if one or more recordings need classification.
- Surfaces a corrupt state file as an error so it can be fixed.

### pending-actions-reminder

- Row id: `task-1779480100560-rjm0gh`
- Series id: `pending-actions-reminder`
- DB: `data/v2-sessions/ag-1779305793766-x8xwuv/sess-1779305793767-0x3tru/inbound.db`
- Schedule: `0 9,14 * * 1-5`
- Prompt: check for unprocessed pending action items from transcript-sync and remind `#sysops` when any remain.
- Script/command from prompt:

```bash
tsx /workspace/extra/skills/transcript-sync/scripts/create-pending-linear-issues.ts --list
```

Script behavior:

- Lists pending action-item batches discovered by transcript-sync.
- Posts a reminder with meeting titles and item counts when any are still pending.
- Stays silent when no pending action items remain.

### transcript sync pipeline (thread copy)

- Row id: `task-1779552048355-62u8ww`
- Series id: `task-1776189304150-2vcn87`
- DB: `data/v2-sessions/ag-1779305793856-h6vg4x/sess-1779305793858-kk8oo8/inbound.db`
- Schedule: `*/30 * * * *`
- Prompt: run transcript sync from a sysops thread session; report failures or meaningful output to `#sysops`.
- Script:

```bash
/workspace/extra/skills/transcript-sync/scripts/run-transcript-sync.sh 2>&1; echo '{"wakeAgent": true}'
```

Script behavior:

- Runs the older transcript-sync wrapper script directly.
- Always wakes the agent after running, regardless of whether anything changed.
- This appears to overlap with the newer `transcript-sync` task above and is a likely duplicate/noisy schedule.

### weekly coaching transcript audit

- Row id: `task-1776189463143-bq5zvi`
- Series id: `task-1776189463143-bq5zvi`
- DB: `data/v2-sessions/ag-1779305793856-h6vg4x/sess-1779305793858-kk8oo8/inbound.db`
- Schedule: `0 9 * * 1`
- Prompt: audit Kevin and Christina coaching transcripts for missing or incomplete generated analysis.
- Script: none stored; agent is expected to inspect transcript-sync output and scripts manually.

Expected behavior:

- Checks coaching transcript output directories, especially Kevin and Christina sessions.
- Finds transcripts without analysis files.
- Finds incomplete or errored analysis files.
- Sends a weekly report even when everything looks clean.

### pending actions / follow-ups check

- Row id: `task-1779480040481-rwms9s`
- Series id: `task-1776189458812-e2qae3`
- DB: `data/v2-sessions/ag-1779305793856-h6vg4x/sess-1779305793858-kk8oo8/inbound.db`
- Schedule: `0 10,14 * * 1-5`
- Prompt: check whether Cian has pending actions, follow-ups, deadlines, or queued items needing attention.
- Script: none stored; agent is expected to review recent conversations, Linear issues, and queued items.

Expected behavior:

- Sends a summary if pending items exist.
- Stays silent by wrapping output in `<internal>` tags if nothing is pending.

## Rebuild Notes

- Recreate the high-frequency transcript-sync task only once. At capture time there were two transcript-sync schedules:
  - `transcript-sync` every 15 minutes in `slack_scheduled`.
  - `task-1776189304150-2vcn87` every 30 minutes in a sysops thread session.
- Prefer the newer gated `transcript-sync` implementation because it stays silent on no-op runs and only wakes the agent for files/errors.
- Keep `oauth-health-check` read-only. The host refresher owns token writes.
- Recreate tasks one at a time and watch `#sysops` plus `logs/nanoclaw.log` for a full cycle before adding the next one.
