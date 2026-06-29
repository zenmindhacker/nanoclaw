# Direct Message — Cian

This is a direct DM channel with Cian. Persona and capabilities are defined in `global/CLAUDE.md`.

## Preferences

• **Timezone:** US/Eastern (Atlanta) — updated 2026-06-26. Previously America/Costa_Rica.
• **Invoice due date:** 15th of the invoice month (for non-NVS clients)
• **NVS PO invoice dates:** Issued month AFTER work period, due end of that month

## Scheduled Tasks

• `task-1782500853230-gv6plu` — NVS email processor, Tuesdays 11am. *Note: scheduled while profile timezone was Costa Rica. If host timezone updated to Eastern, bump cron back to 11.*

## Transmission (Remembrall)

Use the **transmission** skill (`/workspace/extra/skills/transmission/`) to list/add/pause torrents on remembrall.

```bash
/workspace/extra/skills/transmission/scripts/transmission.sh list
/workspace/extra/skills/transmission/scripts/transmission.sh add "magnet:..."
```

RPC: `100.82.7.74:9091` (Tailscale IP — not hostname). Web UI: http://remembrall:9091/transmission/web/

Tool research: `transmission-tools-research.md` in this folder (stig/tremc/torque URLs).

## Movie Night

Use **movie-night** and **torrentday** skills for finding and downloading films.

```bash
/workspace/extra/skills/movie-night/scripts/movie-night.sh library refresh   # rebuild index — run before ownership checks
/workspace/extra/skills/movie-night/scripts/movie-night.sh library status     # verify count (~102) + Harry Potter yes/no
/workspace/extra/skills/movie-night/scripts/movie-night.sh library search --query "Harry Potter"
/workspace/extra/skills/movie-night/scripts/movie-night.sh suggest --decade 1980s --min-imdb 7 --mpaa PG-13
/workspace/extra/skills/movie-night/scripts/movie-night.sh download 2   # after suggest
/workspace/extra/skills/torrentday/scripts/torrentday.sh refresh-login  # if TD session expired
```

**Library refresh:** Always use the script above (writes to `/workspace/agent/`). After refresh, `library status` should show **~102 entries** and **Harry Potter: yes**. If you only see ~25, the refresh failed — run again; do not guess from raw folder counts.

**Owned collections:** Franchise packs on remembrall (e.g. `Harry.Poter.Collection…`) count as owning all films in that series — use `suggest` / `library search`, not title-only matching.

**Flow:** suggest shows owned matches first (no download needed), then new TorrentDay options. Always wait for user to pick before `download`.

**Triggers:** movie night, find a movie, something to watch, what do I have, do I already own.

Preferences: `/workspace/agent/movie-preferences.json` + skill defaults.
