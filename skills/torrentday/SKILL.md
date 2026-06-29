---
name: torrentday
description: Search and download torrents from TorrentDay (private tracker). Uses t.json API and Browserbase for browse/login.
homepage: https://www.torrentday.com
metadata: {"clawdis":{"emoji":"📀","requires":{}}}
---

# TorrentDay

Private tracker search and download for the household TorrentDay account.

**Script:** `{baseDir}/scripts/torrentday.sh`

## Credentials

- `{baseDir}/../credentials` or `/workspace/extra/credentials/torrentday` — UID, PASSKEY, USERNAME, PASSWORD
- `/workspace/extra/credentials/browserbase` — API_KEY, PROJECT_ID, CONTEXT_ID (for browse/login)

## Commands

```bash
torrentday.sh categories [--json]
torrentday.sh search "Goodfellas" --category movX265 [--json] [--limit 10]
torrentday.sh search "star trek" --category movPACKS [--json]
torrentday.sh search-imdb tt0099685 --category movX265
torrentday.sh download <torrent-id> -o /tmp/movie.torrent
torrentday.sh parse "Goodfellas.1990.1080p.x265-LAMA"
torrentday.sh health [--json]
torrentday.sh browse movies [--category movPACKS] [--query "Dune"] [--limit 25] [--json]
torrentday.sh refresh-login
torrentday.sh bb-health [--json]
```

## Categories

Run `torrentday.sh categories --json` for the full list. Key movie categories:

| Name | ID | Use when |
|------|-----|----------|
| `movX265` | 48 | Single films, x265/HEVC |
| `movHD` | 11 | Single films x264, remuxes |
| **`movPACKS`** | **13** | **Collection/boxset/franchise packs** |
| `mov4k` | 96 | 4K/UHD |
| `all` | — | Broad search |

Comma-separated: `--category movX265,movHD`

Browse/search URLs use `t?<id>=1&q=...&cata=yes` (packs: `t?13=1&q=...`).

## Chain to transmission

```bash
torrentday.sh download 7721138 -o /tmp/movie.torrent
/workspace/extra/skills/transmission/scripts/transmission.sh add /tmp/movie.torrent
```
