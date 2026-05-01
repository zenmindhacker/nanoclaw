---
description: Deploy NanoClaw to production server (Cleo — cian@cleo-lc)
---

# Deploy Cleo (nanoclaw → cian@cleo-lc)

Deploy the current repo state to Cleo's NanoClaw instance on the server.
Run from the `nanoclaw` workspace in Windsurf.

## Steps

1. Check for uncommitted changes

```bash
git status --short
```

If there are uncommitted changes, commit or stash them before deploying.

2. Push to GitHub

```bash
git push origin main
```

3. Pull and build on the server

```bash
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git pull --ff-only && npm run build 2>&1 | tail -5"
```

4. Check if Dockerfile changed since last deploy (determines whether to rebuild image)

```bash
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git diff HEAD~1 --name-only | grep -q 'container/Dockerfile' && echo DOCKERFILE_CHANGED || echo DOCKERFILE_UNCHANGED"
```

5. If DOCKERFILE_CHANGED — rebuild the Docker image (takes 3–5 min)

```bash
ssh cian@cleo-lc.cognitivetech.net "docker build --no-cache -t nanoclaw-agent:latest ~/nanoclaw/container/ 2>&1 | tail -10"
```

If DOCKERFILE_UNCHANGED — skip to step 6.

6. Restart Cleo's NanoClaw service

```bash
ssh cian@cleo-lc.cognitivetech.net "systemctl --user restart nanoclaw && sleep 2 && systemctl --user status nanoclaw --no-pager | head -6"
```

7. Smoke test — send Cleo a message in Slack to confirm she's responsive.

---

## Deploy both agents at once

To deploy Silas at the same time, run steps 3–6 again with `christina@cleo-lc` and `~/nanoclaw` pointing to Silas's repo (`Cognitive-Technology/meridian_nanoclaw`):

```bash
ssh christina@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git pull --ff-only && npm run build 2>&1 | tail -5"
```

```bash
ssh christina@cleo-lc.cognitivetech.net "systemctl --user restart nanoclaw && sleep 2 && systemctl --user status nanoclaw --no-pager | head -6"
```

## Rollback

```bash
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git revert HEAD --no-edit && npm run build 2>&1 | tail -3 && systemctl --user restart nanoclaw"
```
