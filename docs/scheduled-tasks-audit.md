# Scheduled tasks audit (Cleo / Silas)

Generated as part of the agent-code-scheduling plan. Re-run:

```bash
pnpm exec tsx scripts/audit-scheduled-tasks.ts
```

## Summary (2026-05-20)

| Agent | Active v2 group folder | Session tasks in DB | Documented but not seeded |
|-------|------------------------|---------------------|---------------------------|
| Cleo | `dm-with-cian` only | **0** | `slack_scheduled` table in `agents/cleo/groups/slack_scheduled/CLAUDE.md` (5 tasks) — **no v2 agent group / wiring** in production DB |
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

## Cleo — slack_scheduled (pending wiring)

Documented schedules (local time — server `TIMEZONE` applies to cron interpretation):

| Task | Documented schedule |
|------|---------------------|
| im-sync | 7:30 AM daily |
| im-digest | 8:00 AM daily |
| im-audit | 9:00 AM Sundays |
| ganttsy-resume-daily | 6:00 AM daily |
| shadow-transcript-sync | 10:40 AM + 12:10 PM daily |

**Action:** Wire `slack_scheduled` messaging group to a Cleo agent group via `/manage-channels` or `ncl`, then add cron rows to `scripts/scheduled-tasks.manifest.json` and run `seed-scheduled-tasks.ts`.

## v1 note

v1 `scheduled_tasks` in `store/messages.db` are ported by `setup/migrate-v2/tasks.ts` during migration. Post-reset production DBs had no task rows until re-seeded.
