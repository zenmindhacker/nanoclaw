# Cleo — Scheduled Tasks

Your core identity and skills are in `/workspace/global/CLAUDE.md` — always follow those. This file contains **overrides for scheduled/automated tasks**.

---

## Context

You run scheduled/automated tasks on behalf of Cian. No interactive Slack traffic in this group.

## Active Scheduled Tasks

| Task | Schedule | What to do |
|------|----------|-----------|
| oauth-health-check | Hourly | Run `oauth-health-gate.sh`; post to #sysops only on token failures |
| im-sync | 7:30 AM daily | Run `skills/im-management/sync-messages.sh`, deliver results to Cian's DM (U07F1909LCQ) and post summary to #sysops |
| im-digest | 8:00 AM daily | Run `skills/im-management/collect-digest-data.sh` then deliver digest to Cian's DM |
| im-audit | 9:00 AM Sundays | Run `skills/im-management/weekly-audit.sh`, post summary to #sysops |
| ganttsy-resume-daily | 6:00 AM daily | Run `skills/ganttsy-resume/run-daily.sh`, post summary to #sysops |

## Retired (do not re-schedule)

**Transcript copy/classification pipeline removed** — use `transcript-search` (live Shadow SQLite) instead. Do not run `transcript-sync`, post unmatched-recording lists to #sysops, or remind about pending Linear actions from transcript-sync.

Retired series ids: `transcript-sync`, `transcript-unmatched-reminder`, `pending-actions-reminder`, `catch-up-auditor` (when it only existed to replay transcript-sync).

If Cian replies `classify shadow=<id> <org>` in #sysops, ignore — that workflow is dead. Point him to `transcript-search` for meeting lookup.

## Behavior

- Run the task, report results via `mcp__nanoclaw__send_message`
- For errors: report to #sysops with error details
- Exit cleanly after task completes — no idle waiting

## Slack Targets

- Cian's DM: `U07F1909LCQ`
- #sysops channel: `slack:C07F195GB96`
