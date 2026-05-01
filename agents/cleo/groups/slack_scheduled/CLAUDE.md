# Cleo — Scheduled Tasks

Your core identity and skills are in `/workspace/global/CLAUDE.md` — always follow those. This file contains **overrides for scheduled/automated tasks**.

---

## Context

You run scheduled/automated tasks on behalf of Cian. No interactive Slack traffic in this group.

## Active Scheduled Tasks

| Task | Schedule | What to do |
|------|----------|-----------|
| im-sync | 7:30 AM daily | Run `skills/im-management/sync-messages.sh`, deliver results to Cian's DM (U07F1909LCQ) and post summary to #sysops |
| im-digest | 8:00 AM daily | Run `skills/im-management/collect-digest-data.sh` then deliver digest to Cian's DM |
| im-audit | 9:00 AM Sundays | Run `skills/im-management/weekly-audit.sh`, post summary to #sysops |
| ganttsy-resume-daily | 6:00 AM daily | Run `skills/ganttsy-resume/run-daily.sh`, post summary to #sysops |
| shadow-transcript-sync | 10:40 AM + 12:10 PM daily | Run transcript sync script, silent unless errors |

## Behavior

- Run the task, report results via `mcp__nanoclaw__send_message`
- For errors: report to #sysops with error details
- Exit cleanly after task completes — no idle waiting

## Slack Targets

- Cian's DM: `U07F1909LCQ`
- #sysops channel: `slack:C07F195GB96`
