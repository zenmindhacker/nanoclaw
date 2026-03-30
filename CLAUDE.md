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
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Deployment

Production Cleo runs on `cleo-lc.cognitivetech.net` (Linux, systemd). Detect where you're running and follow the matching workflow.

### Detect environment
```bash
hostname  # "nanoclaw" = production server, anything else = dev laptop
```

### On the dev laptop (hostname != "nanoclaw")
Edit files locally with full tool access, then deploy via git:
```bash
npm run build                          # verify it compiles
git add <files> && git commit -m "..."  # commit changes
git push                                # push to origin
ssh cian@cleo-lc.cognitivetech.net "cd nanoclaw && git pull && npm run build && sudo systemctl restart nanoclaw"
```
For database changes (scheduled tasks etc.), use SSH + node since sqlite3 is not installed on the server.

### On the production server (hostname == "nanoclaw")
Edit and run everything locally — no SSH needed:
```bash
npm run build
sudo systemctl restart nanoclaw
git add <files> && git commit -m "..."
git push
```

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload (dev laptop only)
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate channel fork, not bundled in core. Run `/add-whatsapp` (or `git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git && git fetch whatsapp main && (git merge whatsapp/main || { git checkout --theirs package-lock.json && git add package-lock.json && git merge --continue; }) && npm run build`) to install it. Existing auth credentials and groups are preserved.

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
