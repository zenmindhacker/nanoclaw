# Post-Upgrade Verification

Production smoke harness for Cleo/Silas after major upgrades (upstream merge, mnemon/wiki, skill lifecycle, Slack changes). Produces JSON for Cursor agents to parse over SSH.

```bash
pnpm run post-upgrade -- --agent cleo --tier 1,2 --json-out /tmp/upgrade-report.json
```

Implementation: `scripts/post-upgrade/`.

## Prerequisites

- NanoClaw host service running on the target machine
- For Tier 2 agent-loop checks: CLI channel wired to the production agent group

### One-time CLI smoke setup (per server)

Wire CLI to the **production** primary group (not a scratch smoke agent):

```bash
pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo
# or
pnpm exec tsx scripts/wire-cli-primary.ts --agent silas
```

Tier 2 memory recall runs via `post-upgrade` — it seeds ephemeral facts into mnemon, wiki, `CLAUDE.local.md`, and `slack_history.json`, then asks natural questions and checks the reply contains the seeded blocker/token.

| Agent | Primary group folder |
|-------|---------------------|
| Cleo | `dm-with-cian` |
| Silas | `dm-with-christina` |

## Usage

```bash
# Tier 1 only (fast, deterministic)
pnpm run post-upgrade -- --agent cleo --tier 1 --json-out /tmp/upgrade-report.json

# Full (Tier 1 + agent loop + synthetic Slack inject)
pnpm run post-upgrade -- --agent cleo --tier 1,2 --json-out /tmp/upgrade-report.json

# Silas
pnpm run post-upgrade -- --agent silas --tier 1,2 --json-out /tmp/upgrade-report.json

# Force Tier 2 even if Tier 1 failed
pnpm run post-upgrade -- --agent cleo --tier 1,2 --force-tier2 --json-out /tmp/report.json
```

From a dev laptop over SSH:

```bash
ssh cian@cleo-lc.cognitivetech.net \
  "cd ~/nanoclaw && pnpm run post-upgrade -- --agent cleo --tier 1,2 --json-out /tmp/upgrade-report.json && cat /tmp/upgrade-report.json"
```

## Tiers

| Tier | Where | What it checks |
|------|-------|----------------|
| **0** | Local / CI | `pnpm test`, `pnpm run typecheck`, `bun test` in agent-runner |
| **1** | Server | Host service, Docker image, OAuth health (Cleo), mnemon/wiki structure, skill audit, read-only skill scripts, Slack wiring, **CLAUDE composition** |
| **2** | Server | CLI ping, **memory recall** (mnemon / wiki / local / thread fixtures), skill catalog prompts, synthetic Slack inbound → outbound.db |

Tier 2 is skipped automatically if Tier 1 has failures (use `--force-tier2` to override).

## Tier 1 composition checks

| Check ID | Validates |
|----------|-----------|
| `composed-claude-imports` | Primary group `CLAUDE.md` has `@./.claude-shared.md` and `@../global/CLAUDE.md`; no stale `@./.claude-global.md` |
| `container-base-persistence` | `container/CLAUDE.md` contains persistence keywords (`SAVE IMMEDIATELY`, `/workspace/global/`) |
| `global-memory-scaffold` | `groups/global/wiki/` and `groups/global/mnemon/` exist |
| `stream-progress-fragment` | `.claude-fragments/module-stream-progress.md` present (Slack fork) |
| `wiki-skill-paths` | `container/skills/wiki/SKILL.md` references `/workspace/global/wiki/` |
| `persona.user-facing` | No deprecated architecture hiding; no scripted capability Q&A |

Existing memory checks in `scripts/post-upgrade/checks/memory.ts` remain (mnemon binary, wiki scaffold, skill catalog, etc.).

## Tier 2 memory recall checks

| Check ID | Layer | Prompt style |
|----------|-------|----------------|
| `memory.mnemon-recall` | mnemon | "What do you remember about Project Zephyr-{nonce}?" |
| `memory.wiki-recall` | wiki page | "Look up … in the wiki — what was the blocker?" |
| `memory.local-recall` | `CLAUDE.local.md` | "Check your agent-wide notes for …" |
| `memory.thread-recall` | `slack_history.json` | "We discussed … in a sysops thread earlier" |

Each fixture uses a unique nonce and verification token. Pass = reply contains the seeded blocker (`oauth refresh token expired`) or token (`__upgrade_test___{nonce}`).

Tier 2 CLI turns allow up to 5 minutes per question (`CHAT_TIMEOUT_MS`). If the CLI socket disconnects before delivery, the harness also checks `outbound.db` for the reply (OpenCode often finishes after the 120s default chat timeout).

- **Skills:** read-only smoke only (`list-names`, `todoist list`, etc.)
- **Slack:** synthetic inbound via session DB + heartbeat — no live Slack posts from the harness
- **Memory:** Tier 2 seeds unique `Project Zephyr-{nonce}` facts per layer; asserts reply recalls blocker/token (not scripted capability language)

## Key files

| File | Role |
|------|------|
| `scripts/post-upgrade/run.ts` | Orchestrator |
| `scripts/post-upgrade/manifest.ts` | Per-agent commands and wiki hints |
| `scripts/post-upgrade/checks/host.ts` | Host + composition checks |
| `scripts/post-upgrade/checks/memory.ts` | Mnemon/wiki structure |
| `scripts/post-upgrade/fixtures/memory-fixtures.ts` | Ephemeral recall seeds for Tier 2 |
| `scripts/post-upgrade/checks/cli-scenarios.ts` | Tier 2 agent loop + memory recall |
| `scripts/post-upgrade/checks/slack-synthetic.ts` | Synthetic Slack inject |

Fork replay inventory: [migrations/guide.md](migrations/guide.md).
