# Agent-owned code in the NanoClaw monorepo

Cleo and Silas share one canonical repo (`nanoclaw`). Runtime state stays on each server under `data/`; durable code and instructions belong in git.

## Where to put things

| What | Path | Mounted in container as |
|------|------|-------------------------|
| Per-agent shared persona | `agents/{cleo\|silas}/groups/global/CLAUDE.md` | `/workspace/global` (read-only) |
| Active channel / DM group | `agents/{agent}/groups/<folder>/` | `/workspace/agent` |
| Channel-specific notes (survive compose) | `.../<folder>/CLAUDE.local.md` | merged into composed `CLAUDE.md` (Cleo/Silas: `git add -f` — tracked in this monorepo) |
| Composed agent instructions | `.../<folder>/CLAUDE.md` | regenerated each spawn — **do not edit for durable content** |
| Reusable host skills | `skills/<name>/` | `/workspace/extra/skills` (via mount allowlist) |
| Container runtime skills | `container/skills/<name>/` | `/app/skills` + symlinks |
| Shared git repos (Cleo) | mounted via allowlist | `/workspace/extra/repos/` |

**Active v2 folders:**

| Agent | Folder | Purpose |
|-------|--------|---------|
| Cleo | `agents/cleo/groups/global/` | Persona, orchestration rules, delegate config |
| Cleo | `agents/cleo/groups/dm-with-cian/` | Primary Slack + DM group |
| Cleo | `agents/cleo/groups/slack_sysops/` | Sysops channel |
| Cleo | `agents/cleo/groups/slack_scheduled/` | Scheduled tasks (NVS, oauth-health) |
| Silas | `agents/silas/groups/global/` | Persona, Christina context |
| Silas | `agents/silas/groups/dm-with-christina/` | Primary DM + cycle tracking scripts |

**Legacy folders to delete on-server** (verify with `ncl groups list` first, then `rm -rf`):

| Agent | Legacy folder | Reason |
|-------|--------------|--------|
| Silas | `agents/silas/groups/christina_dm/` | Old v1 name |
| Silas | `agents/silas/groups/christina-dm/` | Migration artifact |
| Silas | `agents/silas/groups/slack_christina-dm/` | Old Slack channel group |
| Silas | `agents/silas/groups/main/` | Old generic name |
| Silas | `agents/silas/groups/scheduled-tasks/` | Scheduled jobs now in dm-with-christina |

**Rule:** Only add durable files to the active folders above. Do not create new content in legacy folders.

## Commit and push expectations

When you (the agent) create or change **durable** artifacts:

- Scripts, reference docs, images, `CLAUDE.local.md`, task-related data files under `agents/.../groups/...`
- New or updated files under `skills/...` or `container/skills/...`

**Commit and push to `main` promptly** — silently when the change is routine, or after confirming with the operator for large refactors. The operator should not have to remember git for agent work.

Use conventional commit messages, e.g. `feat(silas): update cycle CYCLE_START for May bleed`.

## Do not commit

- `data/` — central DB, session DBs, conversation exports
- `logs/`, `outbox/`, session IPC uploads
- `.env`, `~/.config/nanoclaw/credentials/`
- Generated compose output you could lose anyway (`CLAUDE.md` body when the source of truth is `CLAUDE.local.md`)

## Scheduled tasks (v2)

Tasks are rows in the session `inbound.db` (`kind='task'`), not `current_tasks.json`.

- Register/list via agent MCP `schedule_task` / `list_tasks`, or host `scripts/seed-scheduled-tasks.ts` from `scripts/scheduled-tasks.manifest.json`
- Pre-task `script` must print a final stdout line: `{"wakeAgent": true|false, "data": ...}`
- Audit: `pnpm exec tsx scripts/audit-scheduled-tasks.ts`

Document expected tasks in the group’s `CLAUDE.local.md` or `CLAUDE.md` (for scheduled-only groups) and keep the manifest in sync when seeding from the host.

## Promoting to a skill

Move logic to `skills/<name>/` when:

- Multiple agent groups need the same tool
- The code has its own CLI, tests, or dependencies
- It should appear under `/workspace/extra/skills`

Keep channel-specific state (e.g. Christina’s cycle dates) in the active group folder.

## Server deploy

On each server: `git pull --ff-only`, `pnpm install --frozen-lockfile`, `pnpm run build`, restart `nanoclaw`, rebuild container image when Dockerfile changes. Post-upgrade smoke: [post-upgrade.md](post-upgrade.md).

## Credential lanes

Three lanes, pick the right one — don't default to OneCLI for everything:

| Lane | Use for | Where |
|------|---------|-------|
| Host-owned OAuth refresher | Long-lived refresh tokens (Google, Xero) | Refreshed on the host outside any container; container reads the live access token from a mounted file. See [google-workspace-host-oauth.md](google-workspace-host-oauth.md), [oauth-hybrid-repair.md](oauth-hybrid-repair.md). Do not route through OneCLI. |
| Host-owned static files | Most simple API keys/tokens (TorrentDay, captcha-solver, stagehand config, etc.) | `~/.config/nanoclaw/credentials/services/<name>` on the server, mounted read-only at `/workspace/extra/credentials/` per `mount-allowlist.json`. This is the default lane — reach for it first. |
| OneCLI vault | LLM provider auth (Anthropic) and APIs where **Bearer-in-header is the correct scheme** (`api.github.com`, `opencode.ai`) | `onecli secrets` / `onecli agents`, injected via the gateway into container `HTTPS_PROXY` traffic. |

**Gotcha that broke Silas's git for weeks:** GitHub's git-over-HTTPS endpoints (`info/refs`, `git-upload-pack`, `git-receive-pack` — i.e. `git clone`/`fetch`/`push` against `github.com`) reject `Authorization: Bearer <token>` and require **Basic** auth (`x-access-token:<token>`, base64-encoded). `api.github.com` (the REST/GraphQL API) is fine with Bearer — only the git smart-HTTP host isn't. If you ever touch the OneCLI secret for `github.com`, its `injectionConfig.valueFormat` must be `"Basic {value}"` with a pre-base64-encoded `value`, not `"Bearer {value}"`. The regression check `git.family-repo-auth` in [scripts/post-upgrade/checks/silas-infra.ts](../scripts/post-upgrade/checks/silas-infra.ts) catches this on every post-upgrade run.

Also note: as of the older `onecli-cli` builds installed on both hosts (`2.0.1` / `1.1.0`, vs. `2.2.5` pinned in [versions.json](../versions.json)), `onecli secrets update --value-format ...` silently drops the flag — use `--json '{"value": "...", "injectionConfig": {"headerName": "Authorization", "valueFormat": "Basic {value}"}}'` instead, and verify with `onecli secrets list` afterward.

## Connected Tutors Google Workspace (Silas)

Silas uses **host OAuth** (not OneCLI) for Connected Tutors and Meridian Google accounts.

| Piece | Location |
|-------|----------|
| Skill + gws wrappers | `skills/google-workspace/` → `/workspace/extra/skills/google-workspace` |
| Install skill | `.claude/skills/add-google-workspace-host/SKILL.md` |
| Wire script (on server) | `scripts/silas/wire-google-workspace.sh` |
| CT token | `shadow-google-token.json` / registry id `shadow-google` |
| Meridian token | `meridian-google-token.json` / registry id `meridian-google` |
| Agent policy | `agents/silas/groups/dm-with-christina/CLAUDE.local.md` (Gmail send confirm) |

MCP: `calendar` + `gmail` on group `ag-1779225837260-j7xqo0`. Drive/Docs/Sheets via `gws-ct` until unified MCP spike passes (see `skills/google-workspace/docs/WORKSPACE-MCP-SPIKE.md`).

Credentials mount on Silas must stay **read-only** (`allowReadWrite: false` for `credentials` in `mount-allowlist.json`).

## Shadow DB sync (macOS → Cleo)

Shadow runs on Cian's Mac only. Cleo reads transcripts from `/home/cian/shadow-data/` (mounted as `/workspace/extra/shadow/` in containers).

**Mac LaunchAgent:** `~/Library/LaunchAgents/com.nanoclaw.shadow-sync.plist` — every **15 minutes**, rsyncs `shadow.db` + `-wal` + `-shm` to Cleo. Manual run: `scripts/shadow-sync.sh`. Missed runs while the Mac is asleep are fine; the next wake syncs the latest state.

Re-install after editing the plist:
```bash
launchctl bootout gui/$UID/com.nanoclaw.shadow-sync 2>/dev/null || true
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.nanoclaw.shadow-sync.plist
```
