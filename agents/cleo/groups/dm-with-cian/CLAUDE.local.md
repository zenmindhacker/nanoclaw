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

## Movie Night (v2)

Use **movie-night** and **torrentday** skills. **Always use `--json`** for machine steps; prose is for the user only.

```bash
/workspace/extra/skills/movie-night/scripts/movie-night.sh library refresh --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh library status --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh library list --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh candidates --query "Inception" --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh enrich --title "Inception" --year 2010 --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh download 2 --json   # only after user picks from current list
/workspace/extra/skills/torrentday/scripts/torrentday.sh refresh-login  # if TD session expired
```

### Workflow

1. `library refresh --json` then `library status --json` — verify `entryCount` (~102), cite `groupDir` (`/workspace/agent`)
2. `library list --json` when checking ownership
3. `candidates --query "Title" --json` — code applies movX265 + 1080p + x265 + seeders; you pick the film title only
4. For each candidate, check ownership by reading library **filenames** (no code regex)
5. `enrich --title T [--year Y] --json` only for titles you're about to show (IMDb, MPAA, genre)
6. Apply taste/content filters from `/workspace/agent/movie-preferences.json` (min IMDb, blocked genres, MPAA, decade) — **do not** override quality; `candidates` already enforces 1080p x265
7. Present numbered list of **new** options only
8. Wait for user to pick a number → `download N --json`

### Ownership rules (your judgment, not code)

- Before listing something as new, scan `library list --json` filenames
- Collection folders (name contains `Collection`, or obvious series pack) count as owning all films in that series — e.g. `Harry.Poter.Collection…` covers Harry Potter even with the typo
- When claiming owned, cite the exact `filename` from the library
- If unsure, say so — never invent counts or infer from `diskFoldersCached` vs `entryCount`

### Never

- Call `download` without the user picking a number from the **current** candidate list
- Override quality (category, 1080p, x265) — that stays in `candidates`
- Use removed commands: `suggest`, `library search`, `taste`

**Triggers:** movie night, find a movie, something to watch, what do I have, do I already own.

Preferences: `/workspace/agent/movie-preferences.json` (taste/content) + skill `preferences.json` (quality defaults).
