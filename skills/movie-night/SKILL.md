---
name: movie-night
description: Find movies on TorrentDay, check owned library on remembrall, enrich with OMDB, recommend and download.
homepage: https://www.torrentday.com
metadata: {"clawdis":{"emoji":"🎬","requires":{}}}
---

# Movie Night

Household movie discovery: **library first**, then TorrentDay, OMDB metadata, confirm-before-download.

**Script:** `{baseDir}/scripts/movie-night.sh`

Depends on: `torrentday`, `transmission` skills.

## Credentials

- `/workspace/extra/credentials/omdb` — OMDB API key (free at omdbapi.com)
- torrentday + browserbase (see torrentday skill)

## Preferences

- `{baseDir}/preferences.yaml` — household defaults
- `/workspace/agent/movie-preferences.yaml` — per-agent overrides

## Commands

```bash
movie-night.sh library                    # list owned movies
movie-night.sh library refresh            # rebuild from transmission + remembrall disk scan
movie-night.sh library search --decade 1980s --mpaa PG-13 --min-imdb 7
movie-night.sh taste                      # inferred genres/decades from library
movie-night.sh suggest --decade 1980s --min-imdb 7 --mpaa PG-13 [--query "title"]
movie-night.sh download 2                 # pick from last suggest (new items only)
movie-night.sh enrich "Goodfellas 1990 x265"
```

## Flow

1. `suggest` shows **ALREADY OWN** matches first (no download needed)
2. Then **NEW OPTIONS** from TorrentDay with seeders + IMDb
3. User picks number → `download N` → torrentday + transmission

## Trigger phrases

"movie night", "find a movie", "something to watch", "what do I have", "do I already own"
