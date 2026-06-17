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

## Operator docs (Cleo/Silas)

Fork-specific runbooks — post-upgrade smoke, OAuth repair, extensions, agent-owned code, migration replay:

**[.nanoclaw/README.md](.nanoclaw/README.md)**

## Upstream reference

For architecture, new features, and skill-installable capabilities:

| Doc | Purpose |
|-----|---------|
| [docs/README.md](docs/README.md) | In-repo upstream doc index |
| [docs.nanoclaw.dev](https://docs.nanoclaw.dev) | Published documentation site |
| `.claude/skills/add-*` | Install channels, providers, tools (Ollama, Discord, etc.) |

## Contributing

Before creating a PR or adding a skill, read [CONTRIBUTING.md](CONTRIBUTING.md). Skill taxonomy and authoring: [docs/skill-guidelines.md](docs/skill-guidelines.md). Customizing via skills: [docs/customizing.md](docs/customizing.md).

## PR Hygiene

Before creating a PR:

```bash
git diff upstream/main --stat HEAD
git log upstream/main..HEAD --oneline
```

Show the output and wait for approval. Installation-specific files (group files, `.claude/settings.json`, local configs) should not be included.
