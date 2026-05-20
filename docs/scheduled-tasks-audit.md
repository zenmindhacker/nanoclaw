# Scheduled tasks audit (Cleo / Silas)

Generated as part of the agent-code-scheduling plan. Re-run:

```bash
pnpm exec tsx scripts/audit-scheduled-tasks.ts
```

## Summary (2026-05-20)

| Agent | Active v2 group folder | Session tasks in DB | Documented but not seeded |
|-------|------------------------|---------------------|---------------------------|
| Cleo | `dm-with-cian`; recovered task groups via `scripts/import-v1-scheduled-tasks.ts` | Import from legacy `store/messages.db` | Re-run the import after restoring from old v1 state |
| Silas | `dm-with-christina` | **0** → seed `cycle-daily-briefing` | Was in legacy `christina_dm`; migrated to `dm-with-christina` |

## Silas — cycle daily briefing

| Field | Value |
|-------|--------|
| Task id | `cycle-daily-briefing` |
| Cron (UTC) | `0 11 * * *` |
| Script | `cd /workspace/agent && node cycle_briefing.mjs --task-json $(date -u +%Y-%m-%d)` |
| Assets | `agents/silas/groups/dm-with-christina/cycle_briefing.mjs`, `quotes.mjs`, `cycle_master_reference.md`, images |

Seed after deploy:

```bash
pnpm exec tsx scripts/seed-scheduled-tasks.ts
```

## Cleo — recovered from v1 scheduled tasks

Legacy active tasks are recovered from `store/messages.db`:

```bash
pnpm exec tsx scripts/import-v1-scheduled-tasks.ts .
```

This creates missing v2 agent groups, messaging groups, wirings, and session-local `kind='task'` rows for active v1 tasks. It recomputes the next future cron run instead of importing stale `next_run` timestamps, so recovery does not stampede old tasks immediately.

Recovered task families include:

- `transcript-sync`
- `nvs-email-processor`
- `catch-up-auditor`
- `pending-actions-reminder`
- `transcript-unmatched-reminder`
- Sysops thread tasks (`task-1776189304150-2vcn87`, `task-1776189458812-e2qae3`, `task-1776189463143-bq5zvi`)

Do **not** recover legacy `oauth-token-refresh` (duplicate refresh writer). Host owns refresh via `src/oauth-refresher.ts`; seed read-only `oauth-health-check` from `scripts/scheduled-tasks.manifest.json` for Cleo `#sysops` reporting and `ncl oauth-*` repair.

## v1 note

v1 `scheduled_tasks` in `store/messages.db` are ported by `setup/migrate-v2/tasks.ts` during migration. Post-reset production DBs had no task rows until re-seeded.
