# Cleo/Silas operator docs

Fork-specific runbooks for the `zenmindhacker/nanoclaw` install. Upstream architecture and skills: [docs/README.md](../docs/README.md) and [docs.nanoclaw.dev](https://docs.nanoclaw.dev).

## Operations

| Doc | When |
|-----|------|
| [post-upgrade.md](post-upgrade.md) | After deploy — `pnpm run post-upgrade` smoke harness |
| [oauth-hybrid-repair.md](oauth-hybrid-repair.md) | OAuth token refresh, `#sysops` alerts, `ncl oauth-*` |
| [google-workspace-host-oauth.md](google-workspace-host-oauth.md) | Silas / Connected Tutors Google — host OAuth, skills, MCP, replication |
| [troubleshooting.md](../docs/troubleshooting.md) | Logs and common issues (upstream; links back here for OAuth/post-upgrade) |

## Fork layout

| Doc | When |
|-----|------|
| [fork-extensions.md](fork-extensions.md) | `src/extensions/` and container extensions merge discipline |
| [agent-owned-code.md](agent-owned-code.md) | `agents/cleo`, `agents/silas` — what to commit, deploy |
| [migrations/guide.md](migrations/guide.md) | After upstream pull — replay inventory for `/migrate-nanoclaw` |
| [migrations/extensions.md](migrations/extensions.md) | Why `src/extensions/` exists |
| [migrations/05-dockerfile.md](migrations/05-dockerfile.md) | Dockerfile fork layer ledger |

## Upstream reference (new features)

- [docs/README.md](../docs/README.md) — in-repo upstream docs (merge from upstream/main)
- `.claude/skills/add-*` — installable channels, providers, tools (e.g. Ollama, Discord)
