# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/oauth-refresher.ts` | Host-side OAuth token refresh (all services) |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Secrets / Credentials / Proxy (OneCLI)

API keys, secret keys, OAuth tokens, and auth credentials are managed by the OneCLI gateway — which handles secret injection into containers at request time, so no keys or tokens are ever passed to containers directly. Run `onecli --help`.

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/init-onecli` | Install OneCLI Agent Vault and migrate `.env` credentials to it |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Two-Agent Setup: Cleo and Silas

This repo is the **canonical codebase for two agents** that share identical code but run with separate personas and credentials.

| Agent | Persona | Server user | Port | Groups dir |
|-------|---------|-------------|------|-----------|
| **Cleo** | Cian's assistant | `cian@cleo-lc.cognitivetech.net` | 3001 | `agents/cleo/groups/` |
| **Silas** | Christina's assistant | `christina@cleo-lc.cognitivetech.net` | 3003 | `agents/silas/groups/` |

Both agents pull from **`https://github.com/zenmindhacker/nanoclaw`** (this repo). The old `Cognitive-Technology/meridian_nanoclaw` repo is retired — do not use it.

### What differs per agent

- **`agents/{agent}/groups/`** — CLAUDE.md persona files and per-group configs (in git)
- **`.env`** — credentials, `GROUPS_DIR`, `DATA_DIR` (on server only, never in git)
- **`data/`** — runtime state: SQLite DB, sessions, conversation history, IPC (on server only)

### Key env vars per agent (in `~/{user}/nanoclaw/.env` on server)

```
GROUPS_DIR=agents/cleo/groups   # or agents/silas/groups
DATA_DIR=data
CONTAINER_NAME_PREFIX=nc-cleo   # or nc-silas — must be unique per instance
ASSISTANT_NAME=Cleo              # or Silas
```

## Deployment

Manage from Windsurf on this laptop. Use the `/deploy` workflow (`.windsurf/workflows/deploy.md`).

### Deploy Cleo
```bash
git push origin main
ssh cian@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git pull --ff-only && npm run build 2>&1 | tail -5"
ssh cian@cleo-lc.cognitivetech.net "systemctl --user restart nanoclaw"
```

### Deploy Silas
```bash
ssh christina@cleo-lc.cognitivetech.net "cd ~/nanoclaw && git pull --ff-only && npm run build 2>&1 | tail -5"
ssh christina@cleo-lc.cognitivetech.net "systemctl --user restart nanoclaw"
```

### Rebuild Docker image (only when `container/Dockerfile` changes)
```bash
# Use --no-cache to avoid stale apt layers
ssh cian@cleo-lc.cognitivetech.net "docker build --no-cache -t nanoclaw-agent:latest ~/nanoclaw/container/ 2>&1 | tail -10"
```
Both agents share the same Docker image (`nanoclaw-agent:latest`). Rebuild once, applies to both.

## Logs and Debugging

```bash
# App logs (structured JSON via pino)
ssh cian@cleo-lc.cognitivetech.net "tail -50 ~/nanoclaw/logs/nanoclaw.log"
ssh cian@cleo-lc.cognitivetech.net "tail -30 ~/nanoclaw/logs/nanoclaw.error.log"
ssh christina@cleo-lc.cognitivetech.net "tail -50 ~/nanoclaw/logs/nanoclaw.log"
ssh christina@cleo-lc.cognitivetech.net "tail -30 ~/nanoclaw/logs/nanoclaw.error.log"

# Service status
ssh cian@cleo-lc.cognitivetech.net "systemctl --user status nanoclaw --no-pager | head -20"

# Container logs (per agent session)
# Located at: ~/nanoclaw/groups/{groupname}/logs/container-*.log
```

## Agent Group Configs

Named groups with hand-crafted CLAUDE.md files live in `agents/{agent}/groups/` and are tracked in git.
Runtime thread groups (`t-*/`) are auto-generated on the server and gitignored.

```
agents/
  cleo/groups/
    global/CLAUDE.md        ← Cleo's base persona + capabilities
    main/CLAUDE.md          ← Main group (elevated — full tool access)
    slack_sysops/CLAUDE.md  ← #sysops channel config
    slack_scheduled/CLAUDE.md
  silas/groups/
    global/CLAUDE.md        ← Silas's base persona + capabilities
    main/CLAUDE.md
    slack_christina-dm/CLAUDE.md
    scheduled-tasks/CLAUDE.md
    christina-dm/CLAUDE.md
```

## Audio Transcription

Voice notes from Slack are transcribed on the **host** (not in the container) by `src/channels/slack-media.ts`.

- **Primary**: OpenRouter (`OPENROUTER_API_KEY`) → `openai/gpt-4o-mini-transcribe`
  - Uses JSON + base64 format (NOT multipart — OpenRouter rejects multipart)
  - Endpoint: `https://openrouter.ai/api/v1/audio/transcriptions`
  - Body: `{ model, input_audio: { data: base64, format: "m4a" } }`
- **Fallback**: Direct OpenAI (`OPENAI_API_KEY`) → `whisper-1` with multipart/form-data

If transcription fails, check `nanoclaw.error.log` for the specific error. Common cause: OpenAI quota exceeded — ensure `OPENROUTER_API_KEY` is set in `.env`.

## File/PDF Attachments

PDFs and other files sent via Slack are downloaded to the IPC directory by `src/channels/slack-media.ts`. The agent receives a note like:
- `[PDF attached: /workspace/ipc/files/123-doc.pdf — run \`pdftotext <path> -\` to extract text]`
- `pdftotext` is installed in the container image

Images are saved to `/workspace/ipc/images/` and the agent uses the Read tool to view them.

## Server Paths Reference

| Path | What it is |
|------|-----------|
| `~/nanoclaw/` | NanoClaw repo (both agents) |
| `~/nanoclaw/agents/cleo/groups/` | Cleo's group configs (in git) |
| `~/nanoclaw/agents/silas/groups/` | Silas's group configs (in git) |
| `~/nanoclaw/data/` | Runtime state: DB, sessions, IPC |
| `~/nanoclaw/data/ipc/{group}/` | Per-group IPC files, images, files |
| `~/nanoclaw/data/sessions/{group}/.claude/` | Agent memory (Claude projects) |
| `~/nanoclaw/groups/` | Legacy runtime groups (thread context, logs) — NOT in git |
| `~/nanoclaw/logs/nanoclaw.log` | App stdout log |
| `~/nanoclaw/logs/nanoclaw.error.log` | App error log |
| `~/nanoclaw/skills/` | Host-side skills (mounted into containers) |
| `~/.config/nanoclaw/credentials/services/` | OAuth tokens (auto-refreshed) |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload (dev laptop only)
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## OAuth Token Management

OAuth tokens live in `~/.config/nanoclaw/credentials/services/` and are auto-refreshed by `src/oauth-refresher.ts` on the host.

### Standard Token Format
All token files use consistent fields:
- `access_token`, `refresh_token`, `expires_at` (Unix seconds), `scope`, `token_type`
- Metadata: `provider` (google/xero), `account` (email), `org` (company)
- Google tokens also keep `expiry_date` (ms) for `googleapis` library compat

### OAuth Registry
`~/.config/nanoclaw/credentials/services/oauth-registry.json` maps each token file to its provider, client credential file, refresh endpoint, and metadata. The host refresher reads this on each cycle.

### Refresh Architecture
- **Host refresher** (`src/oauth-refresher.ts`): Runs every 30 min in the main process. Proactively refreshes tokens expiring within 35 min (buffer exceeds check interval so tokens can't expire between cycles).
- **Container consumers**: Read tokens from `/workspace/extra/credentials/` (read-only mount). May have fallback refresh logic.
- **Scheduled health check**: `oauth-token-refresh` task verifies token health, alerts #sysops on issues.

### Adding a New OAuth Token
1. Run the provider's auth flow to get initial tokens
2. Save to `~/.config/nanoclaw/credentials/services/<name>-token.json` using standard format
3. Add entry to `oauth-registry.json` with provider, client_file, account, org
4. Add token + client file to `data/secrets-manifest.json`
5. Host refresher picks it up automatically on next cycle

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
