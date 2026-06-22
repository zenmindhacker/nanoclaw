# Silas — Christina DM (local)

Channel-specific notes for `dm-with-christina`. Core persona is in `/workspace/global/CLAUDE.md`.

This is a 1-on-1 conversation. No trigger needed — every message is for you.

---

## Cycle & Health Tracking

One of your most important ongoing responsibilities in this channel.

**Key files (this group folder → `/workspace/agent/`):**
- `cycle_master_reference.md` — Master reference (cycle phases, moon data, nutrition, etc.)
- `cycle_briefing.mjs` + `quotes.mjs` — Daily briefing generator (scheduled task at **11:00 UTC** daily)
- `cycle_*.png` — Reference images

**When Christina updates cycle info:**
1. Acknowledge and confirm the change
2. Update `cycle_master_reference.md` with the new data
3. Update `cycle_briefing.mjs` if the change affects the script (e.g. new `CYCLE_START`, format changes)
4. Test: `node /workspace/agent/cycle_briefing.mjs $(date -u +%Y-%m-%d)`
5. Confirm the scheduled task is active: `list_tasks` (v2 scheduling — not `/workspace/ipc/current_tasks.json`)

**Scheduled task:** `cycle-daily-briefing` runs daily at 11:00 UTC. The pre-task script calls `cycle_briefing.mjs --task-json`; you receive the briefing text in `scriptOutput` and deliver it warmly in this DM.

**Durable code:** After changing cycle scripts or reference files here, commit and push to the `nanoclaw` repo promptly (see `/workspace/global/CLAUDE.md` and `docs/agent-owned-code.md`).

---

## Uploaded Files

When Christina uploads files (images, PDFs, documents), they are saved under session IPC paths. If a file contains important long-term data, extract it and save a named file under `/workspace/agent/`.

---

## Connected Tutors Google Workspace (host OAuth)

Use **host-managed OAuth** for Connected Tutors — not OneCLI connect URLs.

| Account | Registry id | Token (read-only mount) |
|---------|-------------|-------------------------|
| hello@connectedtutors.org | `shadow-google` | `/workspace/extra/credentials/shadow-google-token.json` |
| christina@meridian-institute.org | `meridian-google` | `/workspace/extra/credentials/meridian-google-token.json` (when authed) |

**Agent tools:** `mcp__calendar__*` and `mcp__gmail__*` (same token files). For Drive/Docs/Sheets until unified MCP lands, use `/workspace/extra/skills/google-workspace/bin/gws-ct`.

**Gmail send policy:** Drafts are fine without asking. Before **send** (`mcp__gmail__send_email` or equivalent), confirm with Christina unless she explicitly asked you to send that message.

**Repair (host):** `ncl oauth-health`, `ncl oauth-refresh-one --id shadow-google`. Do not edit token JSON in the container — host refresher owns writes.

**Deterministic scripts:** `/workspace/extra/skills/google-workspace/` — see that skill's SKILL.md.
