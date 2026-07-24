# AGENTS.md

Project context: [CLAUDE.md](CLAUDE.md), [README.md](README.md), fork runbooks in [.nanoclaw/README.md](.nanoclaw/README.md).

## Cursor Cloud / Cursor Agent instructions

This fork (`zenmindhacker/nanoclaw`) is developed in Cursor (Cloud or local) and deployed to production on **cleo-lc**.

### Canonical loop (do this every time)

```
edit locally → Tier 0 → commit → push origin/main → scripts/deploy-remote.sh → smoke
```

Git is the source of truth for host/container code. Servers must receive changes only via `git pull --ff-only` (through `scripts/deploy-remote.sh` or the manual equivalent below).

| Step | Where | What |
|------|-------|------|
| 1. Edit + debug | Local / Cloud Agent workspace | Fix in this repo; add/adjust unit tests |
| 2. Tier 0 | Local | `pnpm run typecheck` + `pnpm test` (+ agent-runner bun checks when container code changed) |
| 3. Commit | Local | Conventional commits; only when the operator asked, or for routine agent-owned durable files per [.nanoclaw/agent-owned-code.md](.nanoclaw/agent-owned-code.md) |
| 4. Push | Local → `origin/main` | Never leave production-only patches unpushed |
| 5. Deploy | cleo-lc | `scripts/deploy-remote.sh` / `scripts/deploy-remote.sh silas` |
| 6. Smoke | Server | Script runs `post-upgrade`; confirm the bug is gone in Slack if it was user-facing |

### Do not hot-patch production

**Never** `rsync`, `scp`, or hand-edit host/container source on Cleo/Silas to “just fix it live”, then forget git.

Why: the next `git pull --ff-only` fails or silently diverges; the other agent (Cleo vs Silas) stays broken; the next Cloud Agent cannot reproduce or finish the work.

If production is on fire and you must ship a one-line hotfix:

1. Still make the change **in the local workspace first** (or cherry-pick the minimal edit there).
2. Commit + push immediately.
3. Deploy with `scripts/deploy-remote.sh` (both agents if the code is shared).
4. Do **not** leave the server ahead of / divergent from `origin/main`.

Runtime-only state (`data/`, `.env`, credentials, session DBs) stays on the server and is never the vehicle for code fixes.

### Environment bootstrap

`.cursor/environment.json` runs on every Cloud Agent start:

1. **`install`** — `pnpm install --frozen-lockfile`; `bun install` in `container/agent-runner` when Bun is available.
2. **`start`** — `.cursor/setup-ssh.sh` writes `~/.ssh/id_ed25519` from the **`SSH_PRIVATE_KEY`** Runtime Secret and configures host aliases `cleo` / `cleo-silas`.

Optional Runtime Secret: **`SSH_KNOWN_HOSTS`** (output of `ssh-keyscan cleo-lc.cognitivetech.net`). If unset, `setup-ssh.sh` runs `ssh-keyscan` on first boot.

On a local Mac, ensure `~/.ssh/config` has both aliases. Cloud Agents use the public hostname + `SSH_PRIVATE_KEY`; local machines usually reach the box over **Tailscale** (port 22 on the public IP may time out):

```sshconfig
Host cleo
  HostName cleo.tail0ffd4a.ts.net   # or cleo-lc.cognitivetech.net in Cloud Agents
  User cian
  IdentityFile ~/.ssh/nanoclaw-cleo-deploy   # Cloud Agents: ~/.ssh/id_ed25519 from setup-ssh
  IdentitiesOnly yes

Host cleo-silas
  HostName cleo.tail0ffd4a.ts.net
  User christina
  IdentityFile ~/.ssh/nanoclaw-cleo-deploy
  IdentitiesOnly yes
```

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

Only after `git push` to `origin/main` (confirm `git status` is clean / not ahead of origin for the commits you mean to ship):

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

If `git pull --ff-only` fails because the server working tree is dirty: **stop**. Do not force-overwrite agent-owned paths (`agents/`, `skills/`, `data/`) blindly. Discard only hot-patched **host/container application** paths that should match git (`src/`, `container/`, deploy scripts), then pull again. Prefer fixing sync from the git side over inventing a second copy of the tree on the server.

Server layout: Cleo = `cian@cleo-lc`, Silas = `christina@cleo-lc` (same host, different users). Runtime state (`.env`, `data/`) stays on the server — see [.nanoclaw/agent-owned-code.md](.nanoclaw/agent-owned-code.md).

Rebuild container image on server only when `container/Dockerfile` changes: `./container/build.sh`.

Full post-upgrade docs: [.nanoclaw/post-upgrade.md](.nanoclaw/post-upgrade.md).

### What not to run locally in Cloud Agents

Unless explicitly asked: do not start `nanoclaw` as a long-running service, build Docker images, or wire Slack/OAuth. Production integration tests belong on cleo-lc via `post-upgrade`.

### Working-tree gotcha

Booting the host locally can rename `groups/main/CLAUDE.md` → `CLAUDE.local.md`. Restore before commit, or use scratch `GROUPS_DIR` / `DATA_DIR`. Do not commit `data/`, `logs/`, `.heartbeat`, or `.env`.
