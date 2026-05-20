# Server sync runbook (Cleo / Silas)

Both agents run from `~/nanoclaw` on `cleo-lc.cognitivetech.net` under separate Unix users (`cian`, `christina`). This repo is the source of truth; servers should track `origin/main`.

## Before every deploy

On the **target server**, from `~/nanoclaw`:

```bash
mkdir -p logs
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
git diff > "logs/server-diff-$(hostname)-${STAMP}.patch"
git status --short > "logs/server-status-$(hostname)-${STAMP}.txt"
git ls-files --others --exclude-standard >> "logs/server-status-$(hostname)-${STAMP}.txt"
```

Review the patch. If it contains intentional agent edits not yet on your laptop:

1. Copy the patch or files back to your dev machine
2. Commit and push from the laptop
3. Then update the server from git

**Never** `git reset --hard` on a server until the diff is reviewed or intentionally discarded. Hard reset drops uncommitted **tracked** edits permanently.

## Normal update

```bash
cd ~/nanoclaw
git fetch origin
git pull --ff-only origin main
pnpm install --frozen-lockfile   # or pnpm install if lockfile unchanged locally
pnpm run build
# If container/Dockerfile or agent-runner deps changed:
./container/build.sh
systemctl --user restart nanoclaw   # Linux
# launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
```

If `git pull --ff-only` fails, the server has local commits or diverged history — inspect `git log --oneline -5` and reconcile on the laptop, not with blind reset.

## After agent-owned file changes

If the deploy only added files under `agents/*/groups/...`:

```bash
pnpm exec tsx scripts/audit-scheduled-tasks.ts
pnpm exec tsx scripts/seed-scheduled-tasks.ts    # idempotent
```

Restart is only required for **host** (`src/`) or **image** changes, not for group-folder script updates (picked up on next container spawn). Use `ncl groups restart --id <group-id>` if a running container must reload group files immediately.

## Scheduled tasks check

```bash
pnpm exec tsx scripts/audit-scheduled-tasks.ts
```

## Hosts

| Agent | SSH user | Host |
|-------|----------|------|
| Cleo | `cian@cleo-lc.cognitivetech.net` | `~/nanoclaw` |
| Silas | `christina@cleo-lc.cognitivetech.net` | `~/nanoclaw` |

Shared Docker image name: `nanoclaw-agent:latest` (rebuild once on Cleo host if Dockerfile changed; Silas uses the same image).

## Deploy from laptop (typical)

```bash
git push origin main
ssh cian@cleo-lc.cognitivetech.net 'cd ~/nanoclaw && bash -lc "..."'   # snapshot + pull + build + restart
ssh christina@cleo-lc.cognitivetech.net '...'
```

Use the snapshot block inside the remote shell before `git pull`.
