# V2 Deployment Runbook

Follow this top to bottom on each server. Cleo first, then Silas.

---

## Pre-flight (local, before touching servers)

```bash
git checkout main
git pull origin main
git push origin main   # after merging v2 work locally
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

### OpenRouter (image/video only — legacy file, not OneCLI)

**Text delegation** uses OpenCode Go (`delegate summarize`, etc.) — no OpenRouter needed.

**Images / video** use the agent-editable legacy file (not OneCLI):

```bash
# On each host user (Cleo + Silas)
mkdir -p ~/.config/nanoclaw/credentials/services
printf '%s' '<OPENROUTER_API_KEY>' > ~/.config/nanoclaw/credentials/services/openrouter
chmod 600 ~/.config/nanoclaw/credentials/services/openrouter
```

Mounted in containers as `/workspace/extra/credentials/openrouter`. Agents can update this file for new keys they receive in chat.

Do **not** put OpenRouter in OneCLI for text — the orchestrator is already `opencode-go/kimi-k2.6`.

### ElevenLabs (voice notes)

Persona voice notes use the `voice-note` skill and an ElevenLabs key:

```bash
# On each host user (Cleo + Silas)
mkdir -p ~/.config/nanoclaw/credentials/services
printf '%s' '<ELEVENLABS_API_KEY>' > ~/.config/nanoclaw/credentials/services/elevenlabs
chmod 600 ~/.config/nanoclaw/credentials/services/elevenlabs
```

Voice IDs and tuning live in each agent's global `CLAUDE.md`.

### OpenCode Go (for the OpenCode provider)

OpenCode **Go** is a separate product from OpenCode Zen. Go uses different model IDs, a different API base path, and **Bearer** auth on `chat/completions` (not `x-api-key` — that header only works on `/models`).

Get your API key from the [OpenCode Zen console](https://opencode.ai/zen/dashboard) (subscribe to Go there).

```bash
onecli secrets create --name "OpenCode Go" --type generic \
  --value <your-go-api-key> \
  --host-pattern opencode.ai \
  --header-name Authorization --value-format "Bearer {value}"
```

Cleo and Silas on the same host can share one OneCLI gateway and one Go secret if they use the same Zen/Go account.

---

## 4. Configure OpenCode Go in .env

Add to `~/nanoclaw/.env` on **both** Cleo and Silas:

```bash
# OpenCode Go (not regular Zen — note opencode-go/ prefix and /zen/go/v1 path)
OPENCODE_PROVIDER=opencode-go
OPENCODE_MODEL=opencode-go/kimi-k2.6
OPENCODE_SMALL_MODEL=opencode-go/deepseek-v4-flash
ANTHROPIC_BASE_URL=https://opencode.ai/zen/go/v1

# Default provider for new agent groups (host reads this at spawn)
NANOCLAW_DEFAULT_PROVIDER=opencode
```

> **Model IDs for OpenCode Go** ([docs](https://opencode.ai/docs/go/), May 2026):
> - `opencode-go/kimi-k2.6` — best for complex tasks, ~5750 req/month on Go
> - `opencode-go/deepseek-v4-flash` — cheapest, ~158k req/month, good for scheduled tasks
> - `opencode-go/deepseek-v4-pro` — balanced, ~17k req/month
> - `opencode-go/qwen3.6-plus` — good all-rounder, ~16k req/month

For agent groups you want to keep on Claude, set `provider` to `claude` in `container_configs` via `ncl groups config update` or per-group `container.json`.

---

## 5. Rebuild the Docker image

Both users share the same Docker daemon, but **each NanoClaw install gets its own image tag** (`nanoclaw-agent-v2-<install-slug>:latest` from `setup/lib/install-slug.sh`). Run `./container/build.sh` **on each systemd user** (`cian` and `christina`) after pulling code.

Do **not** set `CONTAINER_IMAGE=nanoclaw-agent:latest` in `.env` — that tag is a legacy v1 name and may point at an old image without Bun/OpenCode (containers exit immediately with code 127).

```bash
# On each user account
cd ~/nanoclaw
docker builder prune -f   # optional; prevents stale layers
./container/build.sh
# → nanoclaw-agent-v2-<slug>:latest
```

---

## 6. Wire Slack to an agent group

v2 uses webhooks for Slack (not Socket Mode). Cleo and Silas run on the same host but **different ports** — open both in the firewall (`ufw allow 3000/tcp`, `ufw allow 3002/tcp`).

| Agent | systemd user | `WEBHOOK_PORT` | Slack Request URL |
|-------|--------------|----------------|-------------------|
| Cleo  | `cian`       | `3000`         | `http://cleo-lc.cognitivetech.net:3000/webhook/slack` |
| Silas | `christina`  | `3002`         | `http://cleo-lc.cognitivetech.net:3002/webhook/slack` |

### Update each Slack app

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → the bot's app
2. **Event Subscriptions** → Request URL (see table above)
3. Bot events: `message.channels`, `message.groups`, `message.im`, `message.mpim`, `app_mention`
4. **Interactivity & Shortcuts** → same URL
5. Save (Slack sends `url_verification`; the server responds automatically)

### Add tokens to .env

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
WEBHOOK_PORT=3000   # or 3002 for Silas
ONECLI_URL=http://172.17.0.1:10254
```

### Bootstrap the first DM agent (required once per install)

v2 does not auto-wire existing Slack DMs. Run on the server **while `nanoclaw` is running**:

```bash
# Cleo example — replace IDs from your Slack workspace
pnpm exec tsx scripts/init-first-agent.ts \
  --channel slack \
  --user-id 'slack:U07F1909LCQ' \
  --platform-id 'slack:D0AFGMS9UE6' \
  --display-name 'Cian' \
  --agent-name 'Cleo' \
  --role owner

# Silas example
pnpm exec tsx scripts/init-first-agent.ts \
  --channel slack \
  --user-id 'slack:U0APY537WSG' \
  --platform-id 'slack:D0AQ91FEWE6' \
  --display-name 'Christina' \
  --agent-name 'Silas' \
  --role owner
```

Ensure `GROUPS_DIR` in `.env` points at the right tree (`agents/cleo/groups` or `agents/silas/groups`). The script creates `dm-with-<name>/` under that directory.

**Universal persona:** put shared identity in `groups/global/CLAUDE.md` (loaded for every group). Per-channel notes go in `groups/<folder>/CLAUDE.local.md` only when needed.

Grant OpenCode Go + Anthropic secrets to the new OneCLI agent:

```bash
AGENT_ID=$(onecli agents list | jq -r '.data[] | select(.identifier=="<agentGroupId>") | .id')
OPENCODE_ID=$(onecli secrets list | jq -r '.data[] | select(.name=="OpenCode Go") | .id')
ANTHROPIC_ID=$(onecli secrets list | jq -r '.data[] | select(.name=="Anthropic") | .id')
onecli agents set-secrets --id "$AGENT_ID" --secret-ids "$OPENCODE_ID,$ANTHROPIC_ID"

# Provider in central DB (or rely on NANOCLAW_DEFAULT_PROVIDER=opencode)
pnpm exec tsx -e "
import { initDb } from './src/db/connection.js';
import { runMigrations } from './src/db/migrations/index.js';
import path from 'path';
const db = initDb(path.join('data', 'v2.db'));
runMigrations(db);
db.prepare(\"UPDATE container_configs SET provider='opencode' WHERE agent_group_id=?\").run('<agentGroupId>');
"
```

If you change Go model or `.env` after a failed run, clear the stale OpenCode session:

```bash
SESSION_DIR=data/v2-sessions/<agentGroupId>/<sessionId>
pnpm exec tsx scripts/q.ts "$SESSION_DIR/outbound.db" \
  "DELETE FROM session_state WHERE key LIKE 'continuation:%';"
rm -rf "$SESSION_DIR/opencode-xdg"
docker stop $(docker ps --filter name=nanoclaw-v2 -q) 2>/dev/null || true
```

Or use `/manage-channels` for additional channels after the first agent exists.

---

## 7. Set OpenCode as the provider for specific groups

With `NANOCLAW_DEFAULT_PROVIDER=opencode` in `.env`, new groups default to OpenCode at spawn. Override per group in the DB or materialized `groups/<folder>/container.json`:

```bash
ncl groups list
ncl groups config update --id <group-id> --provider opencode
```

The container runner resolves: session → `container_configs.provider` → `NANOCLAW_DEFAULT_PROVIDER` → `claude`.

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

## Shared host gotchas (Cleo + Silas on one machine)

### OneCLI CA file in `/tmp`

The OneCLI SDK writes `onecli-proxy-ca.pem` under `os.tmpdir()` (usually `/tmp`). On Linux, sticky `/tmp` prevents user B from overwriting a file user A created — Silas (`christina`) fails with `EACCES` if Cleo (`cian`) wrote the cert first.

**Fix:** per-user temp dir in each `.env`:

```bash
TMPDIR=/home/cian/.onecli-tmp        # Cleo
TMPDIR=/home/christina/.onecli-tmp   # Silas
```

Create the directory as that user (`mkdir -p ~/.onecli-tmp && chmod 700 ~/.onecli-tmp`), then restart `nanoclaw`.

### OpenCode Go auth (same for both agents)

Register the OpenCode Go API key in OneCLI with host pattern `opencode.ai` and header **`Authorization: Bearer {key}`** (not `x-api-key` alone — `/models` may work but chat returns 401). Assign secrets to each OneCLI agent (`onecli agents set-secret-mode --mode all` or selective). See section 3.

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
# In .env, OPENCODE_* sets the default for all OpenCode Go groups.
OPENCODE_MODEL=opencode-go/kimi-k2.6
OPENCODE_SMALL_MODEL=opencode-go/deepseek-v4-flash
```

Restart the container (or clear `opencode-xdg` + `session_state`) after changing models in `.env`.
