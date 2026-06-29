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
torrentday.sh search "Goodfellas" --category movX265 [--json] [--limit 10]
torrentday.sh search-imdb tt0099685 --category movX265
torrentday.sh download <torrent-id> -o /tmp/movie.torrent
torrentday.sh parse "Goodfellas.1990.1080p.x265-LAMA"
torrentday.sh health [--json]
torrentday.sh browse movies [--decade 1980s] [--query "Dune"] [--limit 25] [--json]
torrentday.sh refresh-login                          # re-auth via Browserbase
torrentday.sh bb-health [--json]
```

Decade browse searches movX265 once per year in the range (e.g. 1980–1989), dedupes by torrent id, and keeps rows whose release name year matches. Query browse uses `t?48=1&q=...&cata=yes`.

## Categories

`movX265` (48), `movHD` (11), `tvX265` (34), `tvHDx264` (7), `mov4k` (96)

## Chain to transmission

```bash
torrentday.sh download 7721138 -o /tmp/movie.torrent
/workspace/extra/skills/transmission/scripts/transmission.sh add /tmp/movie.torrent
```
