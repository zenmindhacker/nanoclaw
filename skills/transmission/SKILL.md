---
name: transmission
description: Manage torrents on Remembrall (hogwarts router) via Transmission RPC over Tailscale.
homepage: https://github.com/transmission/transmission
metadata: {"clawdis":{"emoji":"📥","requires":{}}}
---

# Transmission (Remembrall)

Control the Transmission daemon on **remembrall** (`100.82.7.74:9091`). Downloads land on `/mnt/movies` (Samba **Movies** share).

**Script:** `{baseDir}/scripts/transmission.sh`

## Credentials

Connection config at `{baseDir}/credentials` (host, port, user, pass). Default: `torrent` / `torrent` @ `100.82.7.74:9091`.

**Important:** From cleo agent containers, always use the **Tailscale IP** (`100.82.7.74`), not hostname `remembrall` (MagicDNS may not resolve in containers). NO_PROXY on cleo includes this IP.

## Running

```bash
{baseDir}/scripts/transmission.sh list
{baseDir}/scripts/transmission.sh add "magnet:?xt=..."
{baseDir}/scripts/transmission.sh session
```

## Commands

```bash
# List torrents (human-readable)
transmission.sh list
transmission.sh list --json

# Session info (download dir, free space)
transmission.sh session

# Add magnet or .torrent URL
transmission.sh add "magnet:?xt=urn:btih:..."

# Control
transmission.sh pause <id> [id...]
transmission.sh resume <id> [id...]
transmission.sh remove <id> [id...]    # remove from client, keep files
transmission.sh purge <id> [id...]     # remove and delete data
```

## Web UI

- Tailscale: http://remembrall:9091/transmission/web/
- LAN: http://192.168.8.1:9091/transmission/web/

## Related tools (optional on host)

Research saved in cleo group folder: `transmission-tools-research.md`

| Tool | URL | Notes |
|------|-----|-------|
| **stig** (recommended TUI) | https://github.com/rndusr/stig | `pip install stig`; `stig set connect.host 100.82.7.74 connect.port 9091` |
| tremc | https://github.com/tremc/tremc | Curses TUI fork |
| torque | https://github.com/dylanaraps/torque | Minimal bash (~50 lines) |
| transmission-rpc-client | https://www.npmjs.com/package/transmission-rpc-client | npm library (this skill uses raw RPC instead) |

## Troubleshooting

- **409 on first request:** Normal — script retries with session id automatically.
- **Timeout from container:** Ensure NO_PROXY includes `100.82.7.74` (cleo nanoclaw `.env` / `opencode.ts`).
- **Restart daemon:** `ssh hogwarts "/etc/init.d/transmission restart"`
