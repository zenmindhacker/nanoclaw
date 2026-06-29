---
name: movie-night
description: Library index, TorrentDay candidates (1080p x265), OMDB enrich, guarded download. Cleo handles ownership and taste.
homepage: https://www.torrentday.com
metadata: {"clawdis":{"emoji":"🎬","requires":{}}}
---

# Movie Night (v2)

Thin facts layer: **code** handles side effects, JSON state, and household quality defaults; **Cleo** handles ownership, taste/MPAA/decade filtering, ranking, and presentation.

**Script:** `{baseDir}/scripts/movie-night.sh`

Depends on: `torrentday`, `transmission` skills.

## Credentials

- `/workspace/extra/credentials/omdb` — OMDB API key (free at omdbapi.com)
- torrentday + browserbase (see torrentday skill)

## Preferences

- `{baseDir}/preferences.json` — household quality defaults (`preferred_quality: movX265`, `preferred_resolution: 1080p`)
- `/workspace/agent/movie-preferences.json` — per-agent **taste/content** (blocked genres, min IMDb, notes)

**Quality is enforced in code** inside `candidates` — do not override category, resolution, or codec from the agent.

## Commands (always use `--json` for machine steps)

```bash
movie-night.sh library refresh [--json]
movie-night.sh library list [--json]
movie-night.sh library status [--json]
movie-night.sh candidates --query "Inception" [--limit 15] [--json]
movie-night.sh enrich --title "Inception" [--year 2010] [--json]
movie-night.sh download 2 [--json]
```

### library refresh

Rebuilds `{ groupDir }/movie-library.json` from Transmission (complete torrents) + remembrall disk folders.

Entry shape: `{ id, source: "transmission"|"disk", filename, path }` — **no OMDB on refresh**.

### library status --json

```json
{ "groupDir", "entryCount", "transmissionComplete", "diskFoldersCached", "updatedAt" }
```

### candidates --query

Searches TorrentDay with fixed quality profile:

1. Category: `movX265` (from preferences)
2. Query augmentation: appends `1080p x265` to the title query
3. Post-filter: release name must contain `1080p` and (`x265` or `hevc`)
4. Sort: descending seeders
5. Writes `movie-night-last-search.json` for `download N`

```json
{
  "query": "Inception",
  "searchQuery": "Inception 1080p x265",
  "quality": { "category": "movX265", "resolution": "1080p", "codec": "x265" },
  "candidates": [{ "id", "name", "seeders", "parsed" }],
  "generatedAt": "..."
}
```

### download N

Reads `movie-night-last-search.json`, downloads candidate #N, adds to Transmission, refreshes library. **Only after user picks a number from the current candidate list.**

### enrich

On-demand OMDB lookup (cached in `omdb-cache.json`). Use before presenting options when IMDb/MPAA/genre matter.

## Cleo workflow

1. `library refresh` → `library status --json` (verify `entryCount`, cite `groupDir`)
2. `library list --json` when ownership matters
3. `candidates --query "..." --json` for TorrentDay options
4. Compare candidates vs library **filenames** (no regex in code)
5. `enrich --title T [--year Y] --json` for titles about to show
6. Present numbered list of **new** options only
7. User picks → `download N`

## Ownership (agent policy)

- Before listing something as new, scan `library list --json` filenames
- Collection folders (name contains `Collection`, or obvious series pack) count as owning all films in that series
- When claiming owned, cite the exact `filename` from the library
- If unsure, say so — never infer from folder counts vs entry counts

## Trigger phrases

"movie night", "find a movie", "something to watch", "what do I have", "do I already own"
