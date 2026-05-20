# Agent-owned code in the NanoClaw monorepo

Cleo and Silas share one canonical repo (`nanoclaw`). Runtime state stays on each server under `data/`; durable code and instructions belong in git.

## Where to put things

| What | Path | Mounted in container as |
|------|------|-------------------------|
| Per-agent shared persona | `agents/{cleo\|silas}/groups/global/CLAUDE.md` | `/workspace/global` (read-only) |
| Active channel / DM group | `agents/{agent}/groups/<folder>/` | `/workspace/agent` |
| Channel-specific notes (survive compose) | `.../<folder>/CLAUDE.local.md` | merged into composed `CLAUDE.md` (Cleo/Silas: `git add -f` — tracked in this monorepo) |
| Composed agent instructions | `.../<folder>/CLAUDE.md` | regenerated each spawn — **do not edit for durable content** |
| Reusable host skills | `skills/<name>/` | `/workspace/extra/skills` (via mount allowlist) |
| Container runtime skills | `container/skills/<name>/` | `/app/skills` + symlinks |
| Shared git repos (Cleo) | mounted via allowlist | `/workspace/extra/repos/` |

**Active v2 folders (check `ncl groups list` / central DB):**

- Cleo: `agents/cleo/groups/dm-with-cian` (and additional groups as wired)
- Silas: `agents/silas/groups/dm-with-christina`

Legacy folders (`christina_dm`, `main`, old `slack_*` names) may still exist on disk; new durable files go in the **active** folder only.

## Commit and push expectations

When you (the agent) create or change **durable** artifacts:

- Scripts, reference docs, images, `CLAUDE.local.md`, task-related data files under `agents/.../groups/...`
- New or updated files under `skills/...` or `container/skills/...`

**Commit and push to `main` promptly** — silently when the change is routine, or after confirming with the operator for large refactors. The operator should not have to remember git for agent work.

Use conventional commit messages, e.g. `feat(silas): update cycle CYCLE_START for May bleed`.

## Do not commit

- `data/` — central DB, session DBs, conversation exports
- `logs/`, `outbox/`, session IPC uploads
- `.env`, `~/.config/nanoclaw/credentials/`
- Generated compose output you could lose anyway (`CLAUDE.md` body when the source of truth is `CLAUDE.local.md`)

## Scheduled tasks (v2)

Tasks are rows in the session `inbound.db` (`kind='task'`), not `current_tasks.json`.

- Register/list via agent MCP `schedule_task` / `list_tasks`, or host `scripts/seed-scheduled-tasks.ts` from `scripts/scheduled-tasks.manifest.json`
- Pre-task `script` must print a final stdout line: `{"wakeAgent": true|false, "data": ...}`
- Audit: `pnpm exec tsx scripts/audit-scheduled-tasks.ts`

Document expected tasks in the group’s `CLAUDE.local.md` or `CLAUDE.md` (for scheduled-only groups) and keep the manifest in sync when seeding from the host.

## Promoting to a skill

Move logic to `skills/<name>/` when:

- Multiple agent groups need the same tool
- The code has its own CLI, tests, or dependencies
- It should appear under `/workspace/extra/skills`

Keep channel-specific state (e.g. Christina’s cycle dates) in the active group folder.

## Server deploy

See [server-sync.md](./server-sync.md) — snapshot server diffs before pull/reset; prefer `git pull --ff-only`.
