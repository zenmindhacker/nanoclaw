# NanoClaw Fork Migration Guide

**Fork:** `zenmindhacker/nanoclaw` (Cleo + Silas two-agent production install)  
**Upstream:** `nanocoai/nanoclaw` (`https://github.com/nanocoai/nanoclaw.git`)  
**Recorded at:** 2026-06-17 (re-based onto upstream v2.1.17, commit `12d53681`, upstream base `ee7f8916`)

This guide captures the intent behind every significant fork customization so
future upgrades can replay them on a clean upstream base without archaeology.
Update this file after each new customization.

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

Upstream never edits `src/extensions/**`. All fork host code lives here.

See `extensions.md` in this directory for the full rationale.

### OAuth Token Refresher

**Intent:** Auto-refresh Google and Xero OAuth tokens from the host process.
Containers mount token files read-only, so only the host can rotate them.
Failures alert `#sysops` via Slack delivery.

**Files:**
- `src/extensions/oauth/refresher.ts` — core refresh logic + registry loading
- `src/extensions/oauth/alerts.ts` — delivers alerts to `OAUTH_ALERT_SLACK_CHANNEL`
- `src/cli/commands/oauth.ts` — `ncl oauth-health`, `ncl oauth-refresh-now`, `ncl oauth-refresh-one`

**Config:** `OAUTH_ALERT_SLACK_CHANNEL=slack:C07F195GB96` in `.env`.  
**Registry:** `~/.config/nanoclaw/credentials/services/oauth-registry.json`  
**Docs:** `docs/oauth-hybrid-repair.md`

**Wiring in `src/index.ts`:**
```typescript
import { initExtensions, teardownExtensions } from './extensions/index.js';
// In main(): initExtensions();
// In shutdown(): teardownExtensions();
```

**On replay:** Copy these three files into `src/extensions/oauth/`, update
`src/cli/commands/index.ts` to import `./oauth.js`, wire `initExtensions` /
`teardownExtensions` in `src/index.ts`, add `OAUTH_ALERT_SLACK_CHANNEL` to
`.env`.

### Slack Streaming Enhancements

**Intent:** Keep Slack DM composer usable while the agent works.
Uses Slack's native `stream()` API (chat.startStream / append / stop).
Adds Thinking Steps cards via `task_update` chunks. Falls back to normal
`postMessage` when metadata or thread context is missing.

**Files:**
- `src/extensions/slack/adapter.ts` — Slack channel adapter (self-registers via `registerChannelAdapter`)
- `src/channels/slack-stream.ts` — session activity + streaming logic (kept in `channels/` because `src/channels/adapter.ts` and `src/delivery.ts` import from it)
- `src/channels/session-activity.ts` — stream types, metadata parsers

**Note:** `session-activity.ts` and `slack-stream.ts` remain in `src/channels/` because
they are imported by core trunk files (`adapter.ts`, `delivery.ts`). Moving them
would require editing core files. Acceptable — these files don't conflict with upstream
because upstream doesn't have Slack in trunk.

**Key behaviours added:**
- `enrichSlackInboundContent`: writes `slackRecipientUserId`, `slackStreamThreadTs` into message content for streaming metadata
- `attachSlackSessionActivity`: hooks `startSessionActivity`, `appendSessionActivity`, `completeSessionActivity`, `cancelSessionActivity` on the bridge
- HTTP-level tracing on Slack API calls for debugging auth issues

**On replay:** Copy `extensions/slack/adapter.ts`, `channels/slack-stream.ts`,
`channels/session-activity.ts`. Remove `import './slack.js'` from
`src/channels/index.ts` (extensions barrel imports the adapter instead). Wire
`appendSessionActivity` into the delivery adapter in `src/index.ts`.

### Voice Transcription

**Intent:** Transcribe WhatsApp voice notes so agents can read and respond to them.

**File:** `src/transcription.ts` — Whisper API via OpenRouter or OpenAI direct.

**Note:** Kept at trunk path `src/transcription.ts` because `src/channels/chat-sdk-bridge.ts`
imports it directly. Cannot move to extensions without editing core files.

**Config:** `OPENROUTER_API_KEY` or `OPENAI_API_KEY` in `.env`.

**On replay:** Copy `src/transcription.ts`. `chat-sdk-bridge.ts` will
already import it — no extra wiring needed.

---

## Host-Mounted Skills (`skills/`)

These are tool code mounted into containers at `/workspace/extra/skills`.
Not part of the agent container image; lived in git under `skills/`.

| Skill | Users | Purpose |
|-------|-------|---------|
| `skills/anylist/` | Silas | AnyList grocery/task list integration |
| `skills/transcript-sync/` | Cleo | Meeting transcript → Linear + Ganttsy sync |
| `skills/invoice-generator/` | Cleo | Xero invoice generation + Toggl time tracking |
| `skills/ganttsy-resume/` | Cleo | Resume parsing + Ganttsy ATS integration |
| `skills/linear/` | Cleo | Linear project management CLI |
| `skills/todoist/` | both | Todoist task management |
| `skills/xero/` | Cleo | Xero accounting helpers |
| `skills/substack/` | both | Substack post publishing |
| `skills/neondb/` | Cleo | NeonDB (Postgres) queries |
| `skills/im-management/` | Cleo | iMessage / Beeper history mgmt |

**On replay:** Copy the `skills/` directory in its entirety. Skills mount via
`~/.config/nanoclaw/mount-allowlist.json` (server-only, not in git).

---

## Agent Group Personas and Memory (`agents/`)

All durable agent artifacts live here. Upstream never has these paths.

```
agents/
  cleo/
    groups/
      global/CLAUDE.md          # Cleo persona, orchestration, delegate rules
      main/                     # Primary Cleo group (Slack + DM)
      slack_sysops/             # Sysops channel group
      slack_scheduled/          # Scheduled tasks group (NVS, oauth-health)
  silas/
    groups/
      global/CLAUDE.md          # Silas persona, Christina context
      dm-with-christina/        # Primary Silas group (Christina DM)
        cycle_briefing.mjs      # Cycle tracking script
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

**Intent:** Graph-based agent memory (`recall`, `remember`, `link`) closing the
Hermes-style procedural memory gap. Under OpenCode/Kimi, hooks don't fire —
context is injected via `readMnemonContext()` in the provider.

**Files:**
- `container/Dockerfile` — mnemon binary install (`MNEMON_VERSION=0.1.14`)
- `container/entrypoint.sh` — `mnemon setup --target claude-code --yes --global`
- `container/agent-runner/src/providers/opencode.ts` — `readMnemonContext()` + `readAgentSkillsCatalog()` in `wrapPromptWithContext()`
- `container/agent-runner/src/providers/opencode-mnemon.test.ts` — structural tests
- `container/skills/mnemon/SKILL.md` — agent instructions
- `.claude/skills/add-mnemon/SKILL.md` — install skill doc

**On replay:**
1. Re-insert mnemon Dockerfile layer from `05-dockerfile.md` (after `/add-opencode` CLI block, before Bun runtime)
2. Add entrypoint `mnemon setup` block
3. After `/add-opencode` installs base provider, overlay fork delta onto `container/agent-runner/src/providers/opencode.ts` (do not blind-copy — diff against fresh base)
4. Copy `container/skills/mnemon/SKILL.md` and test file

**Do not** install `upstream/skill/wiki` — fork uses Karpathy wiki pattern below.

---

## Wiki (Karpathy LLM Wiki Pattern)

**Intent:** Structured markdown knowledge base (sources → wiki → schema) for
synthesized reference material. Distinct from mnemon (facts/decisions).

**Files:**
- `container/skills/wiki/SKILL.md` — ingest/query/lint operations
- `agents/cleo/groups/main/wiki/` — Cleo wiki scaffold (README, index, log, sources/)
- `agents/silas/groups/dm-with-christina/wiki/` — Silas wiki scaffold
- Memory sections in `agents/{cleo,silas}/groups/global/CLAUDE.md`

**On replay:** Copy `container/skills/wiki/SKILL.md` and `agents/` wiki directories.
No host code changes — wiki lives under group mounts at `/workspace/agent/wiki/`.

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
- `src/db/migrations/016-skill-activation-logs.ts` — activation log table
- `src/cli/resources/skills.ts` — `ncl skills audit`
- `src/host-sweep.ts` — daily `sweepSkillArchives()` hook
- `docs/skill-lifecycle.md` — design doc

**On replay:** Copy all files above wholesale. Wire:
- Register migration 016 in `src/db/migrations/index.ts`
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
OPENCODE_MODEL=opencode-go/kimi-k2.6
OPENCODE_SMALL_MODEL=opencode-go/deepseek-v4-flash
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
