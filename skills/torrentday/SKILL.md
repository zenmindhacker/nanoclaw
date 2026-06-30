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
torrentday.sh health [--json]          # unified tjson + browser + download probe
torrentday.sh refresh-login [--json]   # login + scrape passkey from profile
torrentday.sh apply-credential-refresh # host helper — see scripts/apply-credential-refresh.mjs
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

## Auth recovery

When `health --json` returns `recommendation: "refresh-login"`:

```bash
torrentday.sh refresh-login --json
# If hostUpdateRequired:
node skills/torrentday/scripts/apply-credential-refresh.mjs --user cian --file /tmp/td-refresh.json
node skills/torrentday/scripts/apply-credential-refresh.mjs --user christina --file /tmp/td-refresh.json
torrentday.sh health --json
```

Never ask the user to paste a passkey manually.

```bash
torrentday.sh download 7721138 -o /tmp/movie.torrent
/workspace/extra/skills/transmission/scripts/transmission.sh add /tmp/movie.torrent
```
