---
name: transcript-sync
description: Sync meeting transcripts from Shadow and Google Drive to GitHub repos. Runs on a cron every 10 minutes. Use when asked about transcripts, meeting recordings, re-processing meetings, or when calendar matching issues arise. Also handles manual classification of unmatched meetings.
---

# transcript-sync

Syncs meeting transcripts from Shadow (local recorder) and Ganttsy Google Workspace (Drive docs) to the correct GitHub repositories, classified by attendees and content.

## How It Works (4-Stage Pipeline)

1. **Ingest** — batch-fetch all Google Calendar events + transcripts from sources
2. **Candidate Pairing** — match each transcript to calendar events within ±45 min window
3. **LLM Classification** — cheap model (Haiku) resolves ambiguous matches or classifies org directly
4. **Route & Commit** — write markdown, git commit/push to the correct repo

Calendar auth is **mandatory**. If it fails, the pipeline halts and posts to #sysops.

## Running Manually

All commands run from inside the container. The gate script handles setup:

```bash
# Normal run (what cron does every 10 min)
/workspace/extra/skills/transcript-sync/scripts/run-transcript-sync.sh

# Or directly via tsx
cd /workspace/extra/skills/transcript-sync/scripts
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx transcript-sync.ts
```

## Key Flags

| Flag | Description |
|------|-------------|
| `--force` | **Re-process all meetings** in the window, bypassing dedup. Use when asked to redo/reprocess transcripts. |
| `--since-days N` | Look back N days (default: 30) |
| `--dry-run` | Log what would happen without writing files |
| `--report-only` | Show match results (auto/LLM, confidence) without writing |
| `--shadow-only` | Only process Shadow recordings |
| `--ganttsy-workspace-only` | Only process Ganttsy Drive docs |
| `--tasks-mode off` | Skip action item extraction |

## Common Tasks

### Redo the last week of transcripts
```bash
cd /workspace/extra/skills/transcript-sync/scripts
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx transcript-sync.ts --force --since-days 7
```

### Redo with preview first (dry run)
```bash
cd /workspace/extra/skills/transcript-sync/scripts
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx transcript-sync.ts --force --since-days 7 --report-only
```

### Manually classify an unmatched meeting
When a meeting can't be auto-matched or LLM-classified, it appears in #sysops.
The user replies with `classify shadow=<id> <org>` or `skip shadow=<id>`.

```bash
cd /workspace/extra/skills/transcript-sync/scripts
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx classify-transcript.ts shadow=373 ganttsy
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx classify-transcript.ts shadow=347 personal
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx classify-transcript.ts shadow=344 skip
```

Valid orgs: `ganttsy`, `ganttsy-strategy`, `ct`, `ctci`, `nvs`, `personal`, `kevin`, `christina`, `mondo-zen`, `testboard`, `skip`

### List pending manual classifications
```bash
cd /workspace/extra/skills/transcript-sync/scripts
/workspace/extra/skills/transcript-sync/node_modules/.bin/tsx classify-transcript.ts --list
```

### Check logs
```bash
cat /workspace/group/transcript-sync/transcript-sync.log | tail -100
```

## Routing Rules

Meetings are routed by attendee email domains:
- `@ganttsy.com` → `ganttsy/ganttsy-docs/transcripts/` (or `ganttsy-strategy/` for 1:1s)
- `@copperteams.ai` → `copperteams/ct-docs/planning/transcripts/`
- `@newvaluegroup.com`, `@telus.com` → `nvs/nvs-docs/transcripts/`
- Kevin Lee → `coaching/kevin/transcripts/`
- Christina Lane → `coaching/christina/transcripts/`
- Mondo Zen / FMZF → `coaching/mondo-zen/transcripts/`
- No attendees → `personal/transcripts/`
- Default → `cognitivetech/ctci-docs/transcripts/`

## Troubleshooting

- **Calendar auth failure** → check `/workspace/extra/credentials/shadow-google-token.json`. May need re-auth via `auth-ctci-calendar.mjs`.
- **Ganttsy Drive not fetching** → check `/workspace/extra/credentials/ganttsy-google-token.json`. May need re-auth via `auth-ganttsy-drive.mjs`.
- **LLM classifier not working** → check OpenRouter key at `/workspace/extra/credentials/openrouter`.
- **Meetings stuck as unmatched** → widen window with `--calendar-window-minutes 60` or classify manually.
