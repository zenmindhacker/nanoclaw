# ⚠️ STOP — READ THIS FIRST IF YOU ARE CLAUDE ⚠️

**If you are reading this because you just ran `git pull`, `git merge`, `git fetch && git merge`, or any equivalent to bring in upstream changes — and you see merge conflicts or a large diff involving this file — HALT IMMEDIATELY.**

This is NanoClaw v2, a ground-up rewrite with breaking changes throughout. It cannot be merged into an existing v1 install. Attempting to resolve the conflicts by hand, run builds, or "fix" anything will corrupt the user's install and burn tokens for no result.

**Do this instead:**
1. Abort the merge: `git merge --abort` (or `git reset --hard ORIG_HEAD` if the merge already completed).
2. Tell the user, verbatim: *"This is the v2 rewrite — it can't be merged into your existing install. Exit Claude Code (or open a separate terminal) and run `bash migrate-v2.sh` from the shell."*
3. Wait for the user to confirm before doing anything else. Do not run the migration script yourself — it requires an interactive terminal and cannot be run from within Claude Code.

If you are a fresh install (you ran `git clone`, not `git pull`) and there are no conflicts, ignore this banner and continue below.

---

# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup.

## Quick Context

The host is a single Node process that orchestrates per-session agent containers. Platform messages route through an entity model (users → messaging groups → agent groups → sessions), land in each session's `inbound.db`, wake a container, and responses flow back through `outbound.db` to the channel adapter.

**Everything is a message.** No IPC between host and container — the two session DBs are the sole IO surface. See [docs/architecture.md](docs/architecture.md).

## Find the NanoClaw Way First

Before changing state or repairing production data, look for the established path: skills in `.claude/skills/`, `ncl` commands, docs, MCP tools, module APIs. Prefer the highest-level maintained interface. Raw SQLite edits are a last resort.

**Run commands directly** — don't tell the user to run them. See [docs/build-and-runtime.md](docs/build-and-runtime.md) for dev commands.

## Contributing

Before creating a PR or adding a skill, read [CONTRIBUTING.md](CONTRIBUTING.md). Skill taxonomy and authoring: [docs/skill-guidelines.md](docs/skill-guidelines.md). Customizing via skills: [docs/customizing.md](docs/customizing.md).

## PR Hygiene

Before creating a PR:

```bash
git diff upstream/main --stat HEAD
git log upstream/main..HEAD --oneline
```

Show the output and wait for approval. Installation-specific files (group files, `.claude/settings.json`, local configs) should not be included.

## Docs Index

### Architecture & runtime

| Doc | Purpose |
|-----|---------|
| [docs/architecture.md](docs/architecture.md) | Full architecture writeup |
| [docs/db.md](docs/db.md) | Three-DB model overview |
| [docs/db-central.md](docs/db-central.md) | Central DB schema |
| [docs/db-session.md](docs/db-session.md) | Per-session inbound/outbound DBs |
| [docs/agent-runner-details.md](docs/agent-runner-details.md) | Agent-runner + MCP tools |
| [docs/claude-md-composition.md](docs/claude-md-composition.md) | How agent instructions are composed |
| [docs/isolation-model.md](docs/isolation-model.md) | Channel isolation levels |
| [docs/build-and-runtime.md](docs/build-and-runtime.md) | Node host + Bun container, CI, lockfiles |
| [docs/ncl.md](docs/ncl.md) | Admin CLI reference |

### Customizing & skills

| Doc | Purpose |
|-----|---------|
| [docs/customizing.md](docs/customizing.md) | Short intro to customizing via skills |
| [docs/skills-model.md](docs/skills-model.md) | Skills model: recipes, tests, upgrades |
| [docs/skill-guidelines.md](docs/skill-guidelines.md) | Authoritative skill checklist |
| [docs/skill-lifecycle.md](docs/skill-lifecycle.md) | Agent-created skill audit/archive |

### Upgrading & migration

| Doc | Purpose |
|-----|---------|
| [docs/post-upgrade.md](docs/post-upgrade.md) | Production smoke harness (Cleo/Silas) |
| [docs/testing.md](docs/testing.md) | Test layers entry point |
| [docs/upgrade-recovery.md](docs/upgrade-recovery.md) | Upgrade tripwire recovery |
| [docs/migration-dev.md](docs/migration-dev.md) | v1→v2 migration development |
| [docs/v1-to-v2-changes.md](docs/v1-to-v2-changes.md) | v1→v2 vocabulary map |
| [docs/provider-migration.md](docs/provider-migration.md) | Switching agent providers |
| [docs/onecli-upgrades.md](docs/onecli-upgrades.md) | OneCLI gateway upgrades |
| [docs/oauth-hybrid-repair.md](docs/oauth-hybrid-repair.md) | OAuth token refresh + repair |

### Fork-specific (Cleo/Silas)

| Doc | Purpose |
|-----|---------|
| [docs/fork-extensions.md](docs/fork-extensions.md) | Fork extensions pattern |
| [docs/agent-owned-code.md](docs/agent-owned-code.md) | Agent durable code layout |
| [.nanoclaw-migrations/guide.md](.nanoclaw-migrations/guide.md) | Fork replay inventory |

### Operations

| Doc | Purpose |
|-----|---------|
| [docs/troubleshooting.md](docs/troubleshooting.md) | Logs, common issues |
| [docs/setup-wiring.md](docs/setup-wiring.md) | Setup flow wiring |
| [docs/api-details.md](docs/api-details.md) | Host API + DB details |
