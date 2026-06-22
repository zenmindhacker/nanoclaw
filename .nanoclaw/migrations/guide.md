# NanoClaw Fork Migration Guide

**Fork:** `zenmindhacker/nanoclaw` (Cleo + Silas two-agent production install)  
**Upstream:** `nanocoai/nanoclaw` (`https://github.com/nanocoai/nanoclaw.git`)  
**Recorded at:** 2026-06-17 (re-based onto upstream v2.1.17, commit `12d53681`, upstream base `ee7f8916`)

This guide captures the intent behind every significant fork customization so
future upgrades can replay them on a clean upstream base without archaeology.
Update this file after each new customization.

---

## Lost in v2 re-base (audit 2026-06)

Items dropped during `ddc20f78` / upstream re-base (`12d53681`) and restoration status:

| Feature | v1 / backup | Status on main after restoration |
|---------|-------------|----------------------------------|
| Slack thread sync + gap-fill | `src/channels/slack-sync.ts` | **Restored** → `src/extensions/slack/history-sync.ts` |
| IPC `conversation_history.json` | `container-runner.ts` writers | **Replaced** → session DB + `/workspace/agent/slack_*.json` |
| Cross-thread channel context | `dm_history.json` | **Restored** → `slack_channel_history.json` |
| `search_slack_history` MCP | Read-on-file pattern | **Restored** → `container/.../search-history.ts` |
| Delegate worker skill | `container/skills/delegate/` | **Restored** from backup branch |
| `seed-scheduled-tasks.ts` / `audit-scheduled-tasks.ts` | `cf1ded0f` (never on main) | **Restored** from backup commit |
| Cleo im-* / ganttsy crons | manifest + CLAUDE.local | **Restored** in manifest |
| Silas `CLAUDE.local.md` | backup branch | **Restored** |
| Transcript-sync cron | slack_scheduled | **Intentionally retired** → `transcript-search` |
| v1 OAuth/credential-proxy trunk | `src/oauth-refresher.ts` etc. | **Superseded** → `src/extensions/oauth/` |

Stale docs to avoid: `/workspace/ipc/conversation_history.json`, v1 `registered_groups` / `available_groups.json` in legacy `agents/*/groups/main/CLAUDE.md`.

Migration note: skill activation logs migration is **`017-skill-activation-logs.ts`** (not 016).

---

## Context

Two agents share one canonical repo (`nanoclaw`). They differ only by:
- `GROUPS_DIR=agents/cleo/groups` (Cleo) vs `GROUPS_DIR=agents/silas/groups` (Silas)
- `DATA_DIR` and credentials per server
- Agent personas in `agents/{cleo,silas}/groups/global/CLAUDE.md`

Both agents pull from `https://github.com/zenmindhacker/nanoclaw` (this repo).
The server-only divergence lives entirely in `.env` and `~/.config/nanoclaw/`,
not in git.

---

## Applied Skills (from branches)

These were installed via `/add-<name>` skills and pulled from upstream branches.
On replay: re-run the corresponding skill after switching to clean upstream.

| Skill | Branch | What it does |
|-------|--------|-------------|
| `/add-slack` | `channels` | Slack adapter, partially overridden — see Extensions below |
| `/add-opencode` | `providers` | OpenCode provider for Kimi/DeepSeek via OpenCode Go |

---

## Fork Extensions (`src/extensions/`)

Upstream never edits `src/extensions/**`. See [extensions.md](extensions.md) and [../fork-extensions.md](../fork-extensions.md) for merge discipline.

**OAuth:** `src/extensions/oauth/` + `src/cli/commands/oauth.ts` + `OAUTH_ALERT_SLACK_CHANNEL` in `.env`. Docs: [../oauth-hybrid-repair.md](../oauth-hybrid-repair.md). Wire `initExtensions()` / `teardownExtensions()` in `src/index.ts`.

**Slack streaming:** `src/extensions/slack/adapter.ts`, `on-wake.ts`, `history-sync.ts`, `history-sync-hooks.ts`, `src/channels/slack-stream.ts`, `session-activity.ts`, `container/agent-runner/src/extensions/slack/stream-progress.ts`, `search-history.ts`. Ensure `mcp-tools/index.ts` imports `../extensions/index.js`.

**Slack history sync:** Host fetches `conversations.replies` / `conversations.history`, writes `trigger=0` rows to session inbound DBs, exports `slack_history.json` + `slack_channel_history.json` to the agent group folder. Startup + 30min periodic reconciliation. Replaces v1 `slack-sync.ts` + IPC snapshots.

**Voice transcription:** `src/transcription.ts` (trunk path — imported by `chat-sdk-bridge.ts`). Config: `OPENROUTER_API_KEY` or `OPENAI_API_KEY`.

---

## Host-Mounted Skills (`skills/`)

These are tool code mounted into containers at `/workspace/extra/skills`.
Not part of the agent container image; lived in git under `skills/`.

| Skill | Users | Purpose |
|-------|-------|---------|
| `skills/anylist/` | Silas | AnyList grocery/task list integration |
| `skills/transcript-sync/` | Cleo | Meeting transcript → Linear + Ganttsy sync |
| `skills/transcript-search/` | Cleo | Search/grep/extract meeting transcripts from Shadow SQLite |
| `skills/invoice-generator/` | Cleo | Xero invoice generation + Toggl time tracking |
| `skills/ganttsy-resume/` | Cleo | Resume parsing + Ganttsy ATS integration |
| `skills/linear/` | Cleo | Linear project management CLI |
| `skills/todoist/` | both | Todoist task management |
| `skills/xero/` | Cleo | Xero accounting helpers |
| `skills/substack/` | both | Substack post publishing |
| `skills/neondb/` | Cleo | NeonDB (Postgres) queries |
| `skills/im-management/` | Cleo | iMessage / Beeper history mgmt |

**On replay:** Copy `skills/` directory in its entirety. Ensure `defaultMounts`
in `~/.config/nanoclaw/mount-allowlist.json` includes the skills path — upstream
v2.1.17 dropped `getDefaultMounts()` from mount-security; the fork restores it in
`src/modules/mount-security/index.ts` + `src/container-runner.ts` so
`/workspace/extra/skills` is mounted on every container spawn.

Skills mount via
`~/.config/nanoclaw/mount-allowlist.json` (server-only, not in git).

---

## Agent Group Personas and Memory (`agents/`)

All durable agent artifacts live here. Upstream never has these paths.

```
agents/
  cleo/
    groups/
      global/CLAUDE.md          # Cleo persona (persistence rules in container/CLAUDE.md)
      dm-with-cian/              # Primary Cleo group (Slack + DM)
      slack_sysops/             # Sysops channel group
      slack_scheduled/          # Scheduled tasks group (NVS, oauth-health)
  silas/
    groups/
      global/CLAUDE.md          # Silas persona
      dm-with-christina/        # Primary Silas group (Christina DM)
        cycle_briefing.mjs
        cycle_master_reference.md
        quotes.mjs
```

**On replay:** Copy `agents/` verbatim. Point each server's `.env` at its agent:
- Cleo server: `GROUPS_DIR=agents/cleo/groups`
- Silas server: `GROUPS_DIR=agents/silas/groups`

---

## Scheduled Tasks Manifest (`scripts/scheduled-tasks.manifest.json`)

**Intent:** Seed recurring agent tasks (cycle briefing, NVS invoice, oauth health checks)
into the session inbound DB. Run with `pnpm exec tsx scripts/seed-scheduled-tasks.ts`.

**Note:** The manifest has both Cleo and Silas tasks mixed. On replay, this is the
same file — tasks are seeded to the correct session by agent group ID, not by file.

**On replay:** Copy `scripts/scheduled-tasks.manifest.json` unchanged. Re-seed
tasks on the target server via the seed script.

---

## Mnemon Persistent Memory

Graph-based agent memory at `/workspace/global/mnemon/`. Context injected via `readMnemonContext()` under OpenCode/Kimi.

**Files:** `container/Dockerfile` layer (see `05-dockerfile.md`), `container/entrypoint.sh`, `container/agent-runner/src/providers/opencode.ts` overlay, `container/skills/mnemon/SKILL.md`.

**On replay:** Re-insert Dockerfile layer from `05-dockerfile.md`; overlay `opencode.ts` delta after `/add-opencode`; copy mnemon skill + tests.

---

## Wiki (Karpathy LLM Wiki Pattern)

**Intent:** Agent-wide structured markdown knowledge base (sources → wiki → schema).
One wiki per agent install (Cleo, Silas) — **not** per channel group.

**Files:**
- `container/skills/wiki/SKILL.md` — ingest/query/lint operations
- `agents/{cleo,silas}/groups/global/wiki/` — unified wiki (README, index, log, sources/)
- `agents/{cleo,silas}/groups/global/CLAUDE.local.md` — agent-writable personality evolution
- `agents/{cleo,silas}/groups/global/wiki/` — unified wiki
- Persistence discipline lives in `container/CLAUDE.md` (always loaded); persona files hold identity only

**Runtime paths (all Cleo/Silas groups):**
- `/workspace/global/wiki/` — knowledge base (RW)
- `/workspace/global/CLAUDE.local.md` — self-evolved persona (RW)
- `/workspace/global/CLAUDE.md` — git persona base (RO)
- `/workspace/global/mnemon/` — unified memory graph (MNEMON_DATA_DIR)

**On replay:** Copy `container/skills/wiki/SKILL.md`, `src/agent-global.ts`, compose/mount changes, and `agents/{cleo,silas}/groups/global/` tree. Do not delete `groups/global/` on startup.

---

## Fork-Only Host Modules (Skill Lifecycle)

**Intent:** Port microclaw skill auto-improvement: audit, archive, retrieval-gated
catalog, injection scan, end-of-turn review queue. Upstream does not have these.

**Files:**
- `src/modules/skills/audit.ts` — deterministic Jaccard duplicate/staleness audit
- `src/modules/skills/archive.ts` — 30-day archive sweep for `source: agent-created` skills
- `src/modules/skills/catalog.ts` — top-K retrieval-gated skill catalog
- `src/modules/skills/injection-scan.ts` — prompt injection pattern detection
- `src/modules/skills/review-queue.ts` — end-of-turn review (LLM stub)
- `src/db/migrations/017-skill-activation-logs.ts` — activation log table
- `src/cli/resources/skills.ts` — `ncl skills audit`
- `src/host-sweep.ts` — daily `sweepSkillArchives()` hook
- `docs/skill-lifecycle.md` — design doc

**On replay:** Copy all files above wholesale. Wire:
- Register migration 017 in `src/db/migrations/index.ts`
- Register skills CLI in `src/cli/resources/index.ts`
- Merge archive sweep block into upstream `src/host-sweep.ts`

---

## Container Dockerfile Fork Deltas

See `05-dockerfile.md` in this directory for a tracked record of every layer
added to `container/Dockerfile` beyond what upstream ships.

Layers added so far:
- mnemon binary (`MNEMON_VERSION=0.1.14`) — see `05-dockerfile.md`

---

## `.env` Keys Required (both servers)

These are server-only and never committed. Document them here for rebuild.

```
GROUPS_DIR=agents/{cleo|silas}/groups
DATA_DIR=data
CONTAINER_NAME_PREFIX=nc-{cleo|silas}
ASSISTANT_NAME={Cleo|Silas}
AGENT_PROVIDER=opencode
OPENCODE_PROVIDER=opencode-go
OPENCODE_MODEL=opencode-go/deepseek-v4-pro
OPENCODE_SMALL_MODEL=opencode-go/deepseek-v4-flash
OPENCODE_LONG_MODEL=opencode-go/qwen3.7-max
OAUTH_ALERT_SLACK_CHANNEL=slack:C07F195GB96
SLACK_BOT_TOKEN=...
SLACK_SIGNING_SECRET=...
```

---

## Legacy Groups to Clean Up

These group folders are no longer active (DB doesn't point at them) but still exist on disk.
Safe to delete after confirming via `ncl groups list`:

- `agents/cleo/groups/main/` (legacy name — active group may be `dm-with-cian`)
- `agents/silas/groups/main/`
- `agents/silas/groups/christina_dm/`
- `agents/silas/groups/slack_christina-dm/`

Check before deleting: `ncl groups list` on each server.

---

## Post-upgrade verification

See [../post-upgrade.md](../post-upgrade.md) for the full harness (`pnpm run post-upgrade`). Primary groups: Cleo `dm-with-cian`, Silas `dm-with-christina`.

