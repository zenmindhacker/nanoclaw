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

## Movie Night (v2)

Same household movie library as Cian — use **movie-night** and **torrentday** skills. **Always use `--json`** for machine steps.

```bash
/workspace/extra/skills/movie-night/scripts/movie-night.sh categories --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh candidates --query "Title 1080p x265" --category movX265 --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh candidates --query "franchise 1080p" --category movPACKS --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh download 2 --json
```

**You pick `--category`** from user intent: `movX265` for single films, **`movPACKS` for collection/boxset requests** (never assume movX265 finds packs). Put quality terms in `--query` yourself; code does not auto-filter x265. Prefer ~2–4 GB when ranking. Never `download` without Christina picking from the current list.

**Triggers:** movie night, find a movie, something to watch, what do we have.
