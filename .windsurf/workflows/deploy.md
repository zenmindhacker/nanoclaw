---
description: Deploy NanoClaw to production server (Cleo — cian@cleo-lc)
---

# Deploy — Cleo and/or Silas

Both agents run from this repo. Cleo uses `agents/cleo/groups/`, Silas uses `agents/silas/groups/`.
Personas and group configs live under `agents/`. All code is shared.

## Deploy Cleo (cian@cleo-lc)

1. Push to GitHub

```bash
git push origin main
```

2. Pull + build on Cleo's server

```bash
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git pull --ff-only && npm run build 2>&1 | tail -5"
```

3. Check if Dockerfile changed (skip rebuild if not)

```bash
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git diff HEAD~1 --name-only | grep -q 'container/Dockerfile' && echo DOCKERFILE_CHANGED || echo DOCKERFILE_UNCHANGED"
```

4. If DOCKERFILE_CHANGED — rebuild image (3–5 min)

```bash
ssh cian@cleo-lc.cognitivetech.net "docker build --no-cache -t nanoclaw-agent:latest ~/nanoclaw/container/ 2>&1 | tail -10"
```

5. Restart Cleo

```bash
ssh cian@cleo-lc.cognitivetech.net "systemctl --user restart nanoclaw && sleep 2 && systemctl --user status nanoclaw --no-pager | head -5"
```

---

## Deploy Silas (christina@cleo-lc)

Same steps, different user. Silas's server pulls from this same repo.

```bash
ssh christina@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git pull --ff-only && npm run build 2>&1 | tail -5"
```

```bash
ssh christina@cleo-lc.cognitivetech.net "systemctl --user restart nanoclaw && sleep 2 && systemctl --user status nanoclaw --no-pager | head -5"
```

---

## Rollback (either agent)

```bash
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git revert HEAD --no-edit && npm run build 2>&1 | tail -3 && systemctl --user restart nanoclaw"
```

```bash
ssh christina@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git revert HEAD --no-edit && npm run build 2>&1 | tail -3 && systemctl --user restart nanoclaw"
```

---

## Agent config locations

| Agent | Groups dir | Server user | Port |
|-------|-----------|-------------|------|
| Cleo  | `agents/cleo/groups/` | cian@cleo-lc | 3001 |
| Silas | `agents/silas/groups/` | christina@cleo-lc | 3003 |

Each server's `.env` sets `GROUPS_DIR=agents/cleo/groups` or `GROUPS_DIR=agents/silas/groups`.
Thread groups (`t-*/`) are runtime-generated on the server, gitignored.
