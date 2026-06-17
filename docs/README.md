# NanoClaw Documentation

Official docs: **[docs.nanoclaw.dev](https://docs.nanoclaw.dev)**.

This directory holds design references and fork-specific operator guides. Files here are the in-repo source of truth for Cleo/Silas customizations.

## Customizing & skills

| Doc | Purpose |
|-----|---------|
| [customizing.md](customizing.md) | Short intro — fork = skills + recipe |
| [skills-model.md](skills-model.md) | Full skills model: upgrades, tests, migrations |
| [skill-guidelines.md](skill-guidelines.md) | Authoritative skill authoring checklist |
| [skill-lifecycle.md](skill-lifecycle.md) | Agent-created skill audit/archive/catalog |

## Architecture & runtime

| Doc | Purpose |
|-----|---------|
| [architecture.md](architecture.md) | Full architecture writeup |
| [db.md](db.md) | Three-DB model overview |
| [db-central.md](db-central.md) | Central DB schema |
| [db-session.md](db-session.md) | Per-session inbound/outbound DBs |
| [agent-runner-details.md](agent-runner-details.md) | Agent-runner + MCP tools |
| [claude-md-composition.md](claude-md-composition.md) | How agent instructions are composed |
| [isolation-model.md](isolation-model.md) | Channel isolation levels |
| [build-and-runtime.md](build-and-runtime.md) | Node host + Bun container, CI |
| [ncl.md](ncl.md) | Admin CLI reference |

## Upgrading & migration

| Doc | Purpose |
|-----|---------|
| [post-upgrade.md](post-upgrade.md) | Production smoke harness |
| [testing.md](testing.md) | Test layers entry point |
| [upgrade-recovery.md](upgrade-recovery.md) | Upgrade tripwire recovery |
| [migration-dev.md](migration-dev.md) | v1→v2 migration development |
| [v1-to-v2-changes.md](v1-to-v2-changes.md) | v1→v2 vocabulary map |
| [provider-migration.md](provider-migration.md) | Switching agent providers |
| [onecli-upgrades.md](onecli-upgrades.md) | OneCLI gateway upgrades |
| [oauth-hybrid-repair.md](oauth-hybrid-repair.md) | OAuth token refresh + repair |

## Fork-specific (Cleo/Silas)

| Doc | Purpose |
|-----|---------|
| [fork-extensions.md](fork-extensions.md) | Fork extensions pattern |
| [agent-owned-code.md](agent-owned-code.md) | Agent durable code layout |
| [../.nanoclaw-migrations/guide.md](../.nanoclaw-migrations/guide.md) | Fork replay inventory |

## Operations

| Doc | Purpose |
|-----|---------|
| [troubleshooting.md](troubleshooting.md) | Logs, common issues |
| [setup-wiring.md](setup-wiring.md) | Setup flow wiring |
| [api-details.md](api-details.md) | Host API + DB details |

## Mapping to docs.nanoclaw.dev

| This directory | Documentation site |
|---|---|
| [SPEC.md](SPEC.md) | [Architecture](https://docs.nanoclaw.dev/concepts/architecture) |
| [SECURITY.md](SECURITY.md) | [Security model](https://docs.nanoclaw.dev/concepts/security) |
| [REQUIREMENTS.md](REQUIREMENTS.md) | [Introduction](https://docs.nanoclaw.dev/introduction) |
| [docker-sandboxes.md](docker-sandboxes.md) | [Docker Sandboxes](https://docs.nanoclaw.dev/advanced/docker-sandboxes) |
| [APPLE-CONTAINER-NETWORKING.md](APPLE-CONTAINER-NETWORKING.md) | [Container runtime](https://docs.nanoclaw.dev/advanced/container-runtime) |
