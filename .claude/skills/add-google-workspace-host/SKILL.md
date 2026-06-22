---
name: add-google-workspace-host
description: Wire Google Workspace on NanoClaw hosts using host OAuth (not OneCLI) — gws CLI, gmail/calendar MCP, skills/google-workspace lib. Fork-specific; use on Silas (Connected Tutors + Meridian).
---

# Add Google Workspace (host OAuth)

Host-managed OAuth for Google Workspace on agents that **do not** use OneCLI for Google (e.g. Silas on `christina@cleo-lc`). One shared token layer for MCP tools and deterministic scripts.

**Do not use** OneCLI connect URLs or stub files for this path. Containers mount host token JSON **read-only**; only `src/extensions/oauth/refresher.ts` writes tokens.

## Accounts

| Registry id | Account | Token | Client |
|-------------|---------|-------|--------|
| `shadow-google` | hello@connectedtutors.org | `shadow-google-token.json` | `shadow-google-oauth-client.json` |
| `meridian-google` | christina@meridian-institute.org | `meridian-google-token.json` | `google-oauth-client.json` |

## Phase 1: Pre-flight

### Host token files

```bash
ls -la ~/.config/nanoclaw/credentials/services/shadow-google-*.json
pnpm run ncl oauth-health
```

### Credentials mount must be read-only

```bash
grep -A3 credentials ~/.config/nanoclaw/mount-allowlist.json
# defaultMounts entry: containerName "credentials", allowReadWrite: false
```

If writable, OpenCode may wrap tokens as `{ "normal": { ... } }` and break the host refresher. Run:

```bash
bash scripts/silas/wire-google-workspace.sh
```

### Auth (if missing or new scopes)

```bash
# Connected Tutors — full Workspace scopes
sudo node skills/transcript-sync/scripts/auth-hello-ct-calendar.mjs

# Meridian
node skills/google-workspace/scripts/auth-hello-meridian-google.mjs
```

Add registry entries in `~/.config/nanoclaw/credentials/services/oauth-registry.json`:

```json
{
  "id": "shadow-google",
  "token_file": "shadow-google-token.json",
  "provider": "google",
  "token_url": "https://oauth2.googleapis.com/token",
  "client_file": "shadow-google-oauth-client.json",
  "auth_method": "client_secret_post",
  "account": "hello@connectedtutors.org"
}
```

## Phase 2: Repo changes (cli-tools + skill)

Verify `container/cli-tools.json` includes:

| Package | Version | Binary |
|---------|---------|--------|
| `@cocal/google-calendar-mcp` | 2.6.1 | `google-calendar-mcp` |
| `@gongrzhe/server-gmail-autoauth-mcp` | 1.1.11 | `gmail-mcp` |
| `zod-to-json-schema` | 3.22.5 | (gmail-mcp dep) |
| `@googleworkspace/cli` | 0.22.5 | `gws` |

Guard test: `src/google-workspace-cli-tools.test.ts`.

Skill: `skills/google-workspace/` (lib, `gws-ct`, `gws-meridian`, SKILL.md).

## Phase 3: Wire MCP on agent group

Persist via central DB (`ncl`), not hand-edited `container.json`:

```bash
SILAS_GROUP=ag-1779225837260-j7xqo0 bash scripts/silas/wire-google-workspace.sh
```

Or manually:

```bash
pnpm run ncl groups config add-mcp-server \
  --id ag-1779225837260-j7xqo0 \
  --name calendar \
  --command google-calendar-mcp \
  --args '[]' \
  --env '{"GOOGLE_OAUTH_CREDENTIALS":"/workspace/extra/credentials/shadow-google-oauth-client.json","GOOGLE_CALENDAR_MCP_TOKEN_PATH":"/workspace/extra/credentials/shadow-google-token.json"}'

pnpm run ncl groups config add-mcp-server \
  --id ag-1779225837260-j7xqo0 \
  --name gmail \
  --command gmail-mcp \
  --args '[]' \
  --env '{"GMAIL_OAUTH_PATH":"/workspace/extra/credentials/shadow-google-oauth-client.json","GMAIL_CREDENTIALS_PATH":"/workspace/extra/credentials/shadow-google-token.json"}'
```

## Phase 4: Deploy

```bash
pnpm run typecheck && pnpm test
git pull --ff-only && pnpm install --frozen-lockfile && pnpm run build
./container/build.sh
systemctl --user restart nanoclaw
pnpm run ncl oauth-refresh-one --id shadow-google
pnpm run post-upgrade -- --agent silas --tier 1,2
```

## Phase 5: Agent instructions

Update group `CLAUDE.local.md`:

- Use `shadow-google` paths under `/workspace/extra/credentials/`
- MCP: `mcp__calendar__*`, `mcp__gmail__*`
- Drive/Sheets/Docs: `gws-ct` until unified MCP lands
- Gmail send: confirm with operator first
- Repair: `ncl oauth-health`, `ncl oauth-refresh-one --id shadow-google`

## Multi-account (Meridian)

After `auth-hello-meridian-google.mjs`, `wire-google-workspace.sh` adds `meridian-google` registry entry. Use `gws-meridian` or separate MCP env with meridian token paths.

## Unified MCP spike (optional)

See `skills/google-workspace/docs/WORKSPACE-MCP-SPIKE.md`. **Decision:** defer `workspace-mcp` (Python); keep calendar + gmail MCP + gws.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Calendar/Gmail 401 | `ncl oauth-refresh-one --id shadow-google`; flatten `{ normal: ... }` wrapper on token file |
| `expiresInMin` huge negative | Token wrapped or corrupt — flatten + refresh |
| Agent uses OneCLI connect URLs | Update CLAUDE.local; Silas has no OneCLI Google |
| `gws: command not found` | Rebuild container image after cli-tools change |
| Container wrote token file | Set credentials mount `allowReadWrite: false` |

## Rollback

1. `ncl groups config remove-mcp-server --id <group> --name gmail` (and calendar if desired)
2. Remove cli-tools entries and rebuild image
3. Revert `CLAUDE.local.md` Google section
