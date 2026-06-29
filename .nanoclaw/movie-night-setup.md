# Movie Night + TorrentDay setup

Skills live in git under `skills/movie-night/` and `skills/torrentday/`. After deploy or `git pull`, run `npm install` in `skills/torrentday/` (Browserbase deps).

## Host credentials (not in git)

Create files under `~/.config/nanoclaw/credentials/services/` on **each** Linux user that runs agents (cian for Cleo, christina for Silas):

| File | Contents |
|------|----------|
| `torrentday` | `USERNAME`, `PASSWORD`, `UID`, `PASSKEY`, `RSS_MOVX265` |
| `browserbase` | `API_KEY`, `PROJECT_ID`, `CONTEXT_ID` |
| `omdb` | raw API key (one line) from [omdbapi.com](https://www.omdbapi.com/apikey.aspx) |

Copy `skills/transmission/credentials.example` → `skills/transmission/credentials` on the host (or use defaults in SKILL.md).

## Deploy to cleo / Silas

```bash
cd ~/nanoclaw
git pull origin main
cd skills/torrentday && npm install
# Ensure host credentials exist (see table above)
```

## First run

```bash
skills/movie-night/scripts/movie-night.sh library refresh
skills/torrentday/scripts/torrentday.sh refresh-login   # if Browserbase session expired
```

`library refresh` merges **Transmission** (complete torrents) with a **remembrall disk scan** (`ssh root@100.82.7.74 ls /mnt/movies`). Cleo needs its SSH key in remembrall’s `authorized_keys` (one-time). Override host with `REMEMBRALL_SSH` if needed.

Collection packs (e.g. `Harry.Poter.Collection…`) match individual franchise films via franchise detection — no need to download sequels you already own on disk.

Runtime cache (`movie-library.json`, `omdb-cache.json`) lives in the agent group folder and is gitignored via `agents/.gitignore`.
