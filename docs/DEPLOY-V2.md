# V2 Deployment Runbook

Follow this top to bottom on each server. Cleo first, then Silas.

---

## Pre-flight (local, before touching servers)

```bash
# Push the v2-migration branch to origin
git push origin v2-migration
```

---

## 1. Pull and build on the server

```bash
# Cleo
ssh cian@cleo-lc.cognitivetech.net

cd ~/nanoclaw
git fetch origin
git checkout v2-migration
git pull --ff-only origin v2-migration
pnpm install
pnpm run build
```

```bash
# Silas (separate SSH session)
ssh christina@cleo-lc.cognitivetech.net

cd ~/nanoclaw
git fetch origin
git checkout v2-migration
git pull --ff-only origin v2-migration
pnpm install
pnpm run build
```

---

## 2. Install OneCLI Agent Vault

Run on **each server user** (`cian` for Cleo, `christina` for Silas).

```bash
# Install the gateway
curl -fsSL onecli.sh/install | sh

# Install the CLI
curl -fsSL onecli.sh/cli/install | sh

# Add to PATH if needed
export PATH="$HOME/.local/bin:$PATH"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# Verify
onecli version
```

Point the CLI at the local gateway. The installer output the URL — usually `http://localhost:10254`:

```bash
onecli config set api-host http://localhost:10254
echo 'ONECLI_URL=http://localhost:10254' >> ~/nanoclaw/.env
```

Wait for gateway:
```bash
curl -sf http://localhost:10254/health && echo "Gateway up"
```

---

## 3. Migrate credentials to OneCLI

**Anthropic credential** — v2 uses OneCLI, not raw keys in `.env`.

If you have a Claude Max subscription (OAuth), get the token:
```bash
claude setup-token
# Copy the token it prints
```

Register it:
```bash
onecli secrets create --name Anthropic --type anthropic \
  --value <your-token-or-api-key> \
  --host-pattern api.anthropic.com
```

Then remove the old key from `.env`:
```bash
# Edit .env and remove these lines if present:
# ANTHROPIC_API_KEY=...
# CLAUDE_CODE_OAUTH_TOKEN=...
# ANTHROPIC_AUTH_TOKEN=...
```

Verify:
```bash
onecli secrets list
# Should show "Anthropic" secret
```

### OpenRouter (for delegate skill and transcription)

```bash
onecli secrets create --name OpenRouter --type generic \
  --value <OPENROUTER_API_KEY> \
  --host-pattern openrouter.ai \
  --header-name Authorization --value-format "Bearer {value}"
```

Remove from `.env`:
```bash
# Remove: OPENROUTER_API_KEY=...
```

### OpenCode Go (for the OpenCode provider)

Register with `x-api-key` header (Zen uses x-api-key, not Bearer):
```bash
onecli secrets create --name "OpenCode Go" --type generic \
  --value <your-zen-api-key> \
  --host-pattern opencode.ai \
  --header-name x-api-key --value-format "{value}"
```

Get your Zen API key from: https://opencode.ai/zen/dashboard

---

## 4. Configure OpenCode in .env

Add to `~/nanoclaw/.env`:

```bash
# OpenCode Go as primary provider
OPENCODE_PROVIDER=opencode
OPENCODE_MODEL=opencode/kimi-k2.6
OPENCODE_SMALL_MODEL=opencode/deepseek-v4-flash
ANTHROPIC_BASE_URL=https://opencode.ai/zen/v1
```

> **Model IDs for OpenCode Go** (as of May 2026):
> - `opencode/kimi-k2.6` — best for complex tasks, ~5750 req/month on Go
> - `opencode/deepseek-v4-flash` — cheapest, ~158k req/month, good for scheduled tasks
> - `opencode/deepseek-v4-pro` — balanced, ~17k req/month
> - `opencode/qwen3.6-plus` — good all-rounder, ~16k req/month

For agent groups you want to keep on Claude (e.g. main control group), set `agent_provider=claude` via `ncl` after wiring (see step 6).

---

## 5. Rebuild the Docker image

**Run once on Cleo's server** — both agents share the same image.

```bash
ssh cian@cleo-lc.cognitivetech.net
cd ~/nanoclaw

# Prune builder cache first (prevents stale OpenCode layer)
docker builder prune -f

# Build — includes opencode-ai@1.4.17 now
./container/build.sh
```

---

## 6. Wire Slack to an agent group

v2 uses webhooks for Slack (not Socket Mode). The webhook server runs on port 3000.

### Update your Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → your NanoClaw app
2. **Event Subscriptions** → set Request URL to `https://cleo-lc.cognitivetech.net:3000/webhook/slack`
   - (or whatever port/domain your server uses)
3. Under bot events, confirm these are subscribed: `message.channels`, `message.groups`, `message.im`, `app_mention`
4. **Interactivity & Shortcuts** → set same URL
5. Click **Reinstall app** when prompted

### Add tokens to .env

```bash
# Cleo server — cian's Slack workspace
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
WEBHOOK_PORT=3000

# Sync to container env dir
mkdir -p data/env && cp .env data/env/env
```

### Wire the channel via ncl CLI

```bash
# List groups to find your agent group ID
ncl groups list

# Wire Slack to Cleo's main agent group
# Replace <agent-group-id> with the ID from the list above
ncl wirings create \
  --messaging-group slack:D<your-dm-id> \
  --agent-group <agent-group-id> \
  --session-mode shared
```

Or run `/manage-channels` from inside a Claude Code session and follow the interactive flow.

---

## 7. Set OpenCode as the provider for specific groups

By default, agent groups use Claude. Switch specific groups to OpenCode:

```bash
# Find the agent group ID
ncl groups list

# Set provider on a group (e.g. a scheduled-tasks group)
ncl groups update --id <group-id> --agent-provider opencode
```

Or edit `data/v2-sessions/<group-id>/container.json`:
```json
{
  "provider": "opencode"
}
```

Grant the OpenCode Go secret to that agent:
```bash
AGENT_ID=$(onecli agents list | jq -r '.data[] | select(.identifier=="<agentGroupId>") | .id')
CURRENT=$(onecli agents secrets --id "$AGENT_ID" | jq -r '[.data[]] | join(",")')
OPENCODE_SECRET_ID=$(onecli secrets list | jq -r '.data[] | select(.name=="OpenCode Go") | .id')
MERGED=$(printf '%s' "$CURRENT,$OPENCODE_SECRET_ID" | tr ',' '\n' | sort -u | paste -sd ',' -)
onecli agents set-secrets --id "$AGENT_ID" --secret-ids "$MERGED"
```

---

## 8. Restart the service

```bash
# Cleo
ssh cian@cleo-lc.cognitivetech.net
systemctl --user restart nanoclaw
systemctl --user status nanoclaw --no-pager | head -20

# Silas
ssh christina@cleo-lc.cognitivetech.net
systemctl --user restart nanoclaw
systemctl --user status nanoclaw --no-pager | head -20
```

---

## 9. Verify

```bash
# Check logs for OneCLI and startup
tail -50 ~/nanoclaw/logs/nanoclaw.log | grep -E "onecli|provider|slack|error"

# Confirm no errors
tail -20 ~/nanoclaw/logs/nanoclaw.error.log
```

Send a test message from Slack to confirm the agent responds.

---

## 10. Rollback

If anything goes wrong, roll back to the v1 `main` branch:

```bash
# On the server
cd ~/nanoclaw
git checkout main
npm install
npm run build
systemctl --user restart nanoclaw
```

The v1 codebase is intact on `main` with the rollback tag `pre-update-baeef79-20260514-120941`.

---

## Ongoing: switching models per group

```env
# In .env, OPENCODE_* sets the default for all OpenCode groups.
# To use different models per group, set container.json per session:
# data/v2-sessions/<group-id>/container.json
{
  "provider": "opencode",
  "model": "opencode/deepseek-v4-flash"
}
```

Per-group model overrides are also configurable via `ncl groups update --model <model-id>` once the CLI gains that field (check `ncl groups update --help` on the server).
