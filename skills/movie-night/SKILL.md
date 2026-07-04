---
name: movie-night
description: Library index, TorrentDay candidates, OMDB enrich, guarded download. Cleo picks category and filters; code returns facts.
homepage: https://www.torrentday.com
metadata: {"clawdis":{"emoji":"🎬","requires":{}}}
---

# Movie Night (v2)

Thin facts layer: **code** handles side effects and JSON state; **Cleo** picks TorrentDay category, quality filters, ownership, taste, and presentation.

**Script:** `{baseDir}/scripts/movie-night.sh`

Depends on: `torrentday`, `transmission` skills.

## Credentials

- `/workspace/extra/credentials/omdb` — OMDB API key (free at omdbapi.com)
- torrentday + stagehand + captcha-solver (see torrentday skill)

## Preferences

- `{baseDir}/preferences.json` — household defaults (`preferred_quality: movX265` = default category for single films)
- `/workspace/agent/movie-preferences.json` — per-agent taste/content (blocked genres, min IMDb, notes)

**You choose category and query terms** — code does not auto-filter x265 or append quality tokens.

## Commands (always use `--json` for machine steps)

```bash
movie-night.sh categories [--json]
movie-night.sh library refresh [--json]
movie-night.sh library list [--json]
movie-night.sh library status [--json]
movie-night.sh candidates --query "Star Trek" --category movPACKS [--limit 15] [--json]
movie-night.sh enrich --title "Inception" [--year 2010] [--json]
movie-night.sh download 2 [--json]
```

### categories

Lists all TorrentDay categories with `name`, `ids`, `label`, `group`, `useWhen`. Run once when unsure; also via `torrentday.sh categories`.

### candidates --query --category

Searches TorrentDay in the **category you specify**, sorts by seeders, writes `movie-night-last-search.json`.

- **No** automatic `1080p x265` append — put quality tokens in `--query` when you want them
- **No** post-filter on codec/resolution — you filter when presenting
- Default `--category` is `movX265` from preferences if omitted (single-film default only)

```json
{
  "query": "star trek 1080p",
  "searchQuery": "star trek 1080p",
  "category": "movPACKS",
  "categoryIds": [13],
  "candidates": [{ "id", "name", "seeders", "sizeGb", "categoryId", "parsed" }],
  "generatedAt": "..."
}
```

### Category selection (agent policy)

| User intent | Category | Example query |
|-------------|----------|---------------|
| Single film, efficient encode | `movX265` | `"Inception 1080p x265"` |
| Single film, HDR/remux/x264 | `movHD` | `"Dune 1080p"` |
| **Collection / boxset / franchise pack** | **`movPACKS`** | `"star trek 1080p"` |
| Unsure / thin results | `all` or retry another category | `"Star Trek collection"` |

**Never** claim "no pack exists" after searching only `movX265`. Packs live in **`movPACKS` (id 13)** — the category the website uses for `t?13=on&q=...`.

If first search is empty or wrong shape, run **another `candidates` call** with a different category before telling the user nothing is available.

### download N

Reads `movie-night-last-search.json`, downloads candidate #N, adds to Transmission, refreshes library. **Only after user picks a number from the current candidate list.**

For a specific torrent ID the user pasted, use `torrentday.sh download <id>` + transmission add.

### enrich

On-demand OMDB lookup (cached in `omdb-cache.json`).

## Cleo workflow

1. `library refresh` → `library status --json`
2. `library list --json` when ownership matters
3. **`categories --json`** if you need a refresher on TD categories
4. `candidates --query "..." --category <pick> --json` — pick category from intent (pack → `movPACKS`)
5. Compare vs library filenames; apply taste/quality/size preferences when **presenting**
6. User picks → `download N`

## Ownership (agent policy)

- Scan `library list --json` filenames before listing something as new
- Collection folders count as owning the series — cite exact `filename`
- If unsure, say so

## Size (agent policy)

Prefer **~2–4 GB** per film when `sizeGb` is present. Judgment call, not code.

## Trigger phrases

"movie night", "find a movie", "something to watch", "what do I have", "do I already own"
