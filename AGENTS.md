# AGENTS.md

Project context: [CLAUDE.md](CLAUDE.md), [README.md](README.md), fork runbooks in [.nanoclaw/README.md](.nanoclaw/README.md).

## Cursor Cloud specific instructions

This fork (`zenmindhacker/nanoclaw`) is developed in Cursor Cloud Agents and deployed to production on **cleo-lc**. The typical loop is: edit here → Tier 0 checks → push → deploy on server → post-upgrade smoke.

### Environment bootstrap

`.cursor/environment.json` runs on every agent start:

1. **`install`** — `pnpm install --frozen-lockfile`; `bun install` in `container/agent-runner` when Bun is available.
2. **`start`** — `.cursor/setup-ssh.sh` writes `~/.ssh/id_ed25519` from the **`SSH_PRIVATE_KEY`** Runtime Secret and configures host aliases `cleo` / `cleo-silas`.

Optional Runtime Secret: **`SSH_KNOWN_HOSTS`** (output of `ssh-keyscan cleo-lc.cognitivetech.net`). If unset, `setup-ssh.sh` runs `ssh-keyscan` on first boot.

Verify SSH after a new agent session:

```bash
ssh -o BatchMode=yes cleo echo ok
ssh -o BatchMode=yes cleo-silas echo ok
```

### Tier 0 — run before push (no SSH, no Docker)

```bash
pnpm run typecheck
pnpm test
cd container/agent-runner && bun test && bun run typecheck
```

Docker, OneCLI, and `.env` are **not** required for host/container unit tests.

### Deploy and smoke (Tier 1/2 on server)

After pushing to `main`:

```bash
scripts/deploy-remote.sh           # Cleo, tier 1+2
scripts/deploy-remote.sh silas     # Silas
scripts/deploy-remote.sh cleo 1    # Tier 1 only (fast)
```

Manual equivalent:

```bash
ssh cleo "cd ~/nanoclaw && git pull --ff-only && pnpm install --frozen-lockfile && pnpm run build && systemctl --user restart nanoclaw"
ssh cleo "cd ~/nanoclaw && pnpm run post-upgrade -- --agent cleo --tier 1,2 --json-out /tmp/report.json && cat /tmp/report.json"
```

Server layout: Cleo = `cian@cleo-lc`, Silas = `christina@cleo-lc` (same host, different users). Runtime state (`.env`, `data/`) stays on the server — see [.nanoclaw/agent-owned-code.md](.nanoclaw/agent-owned-code.md).

Rebuild container image on server only when `container/Dockerfile` changes: `./container/build.sh`.

Full post-upgrade docs: [.nanoclaw/post-upgrade.md](.nanoclaw/post-upgrade.md).

### What not to run locally in Cloud Agents

Unless explicitly asked: do not start `nanoclaw` as a long-running service, build Docker images, or wire Slack/OAuth. Production integration tests belong on cleo-lc via `post-upgrade`.

### Working-tree gotcha

Booting the host locally can rename `groups/main/CLAUDE.md` → `CLAUDE.local.md`. Restore before commit, or use scratch `GROUPS_DIR` / `DATA_DIR`. Do not commit `data/`, `logs/`, `.heartbeat`, or `.env`.
