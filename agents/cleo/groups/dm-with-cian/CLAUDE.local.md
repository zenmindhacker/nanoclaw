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
/workspace/extra/skills/movie-night/scripts/movie-night.sh categories --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh library refresh --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh library status --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh library list --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh candidates --query "star trek 1080p" --category movPACKS --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh candidates --query "Inception 1080p x265" --category movX265 --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh enrich --title "Inception" --year 2010 --json
/workspace/extra/skills/movie-night/scripts/movie-night.sh download 2 --json
/workspace/extra/skills/torrentday/scripts/torrentday.sh refresh-login
```

### You choose category + query (not code)

Run `categories --json` when unsure. Key movie categories:

| Intent | `--category` | Notes |
|--------|--------------|-------|
| Single film, x265 | `movX265` | Default; add `1080p x265` to query yourself |
| Single film, x264/HDR | `movHD` | |
| **Pack / collection / boxset** | **`movPACKS`** | **id 13** — site URL `t?13=on&q=...` |
| Broad retry | `all` | When results are thin |

**Never** say a pack doesn't exist after only searching `movX265`. Franchise/collection packs are in **`movPACKS`**. If wrong results, run another `candidates` with the right category before reporting empty.

### Workflow

1. `library refresh --json` → `library status --json`
2. `library list --json` for ownership
3. Pick **category from user intent** → `candidates --query "..." --category ... --json`
4. Ownership check via filenames; `enrich` when IMDb/MPAA matters
5. Apply taste from `movie-preferences.json`; prefer **~2–4 GB** and **1080p x265** when ranking (your judgment — code does not filter these)
6. Present numbered **new** options only → user picks → `download N`

If user pastes a torrent URL/ID: `torrentday.sh download <id>` then transmission add.

### Ownership rules

- Cite exact library `filename` when claiming owned
- Collection folders count as owning the series (`Harry.Poter.Collection…`, etc.)
- If unsure, say so — never invent counts

### Never

- `download` without user picking from the **current** candidate list
- Assume `movX265` covers packs
- Use removed commands: `suggest`, `library search`, `taste`

**Triggers:** movie night, find a movie, something to watch, what do I have, do I already own.

Preferences: `/workspace/agent/movie-preferences.json` + skill `preferences.json`.
