# Testing

Entry point for NanoClaw test layers. Pick the layer that matches what you're changing.

## Local development

```bash
# Host (Node + vitest)
pnpm test
pnpm run typecheck
pnpm run build

# Agent-runner (Bun)
cd container/agent-runner && bun test
cd container/agent-runner && bun run typecheck
```

## CI

See [build-and-runtime.md](build-and-runtime.md) for the CI pipeline: host `vitest`, container `bun:test`, typecheck split across Node/Bun trees.

## Per-skill integration tests

Every skill that reaches into core code must ship a test that goes red if the wiring is deleted or drifts. That is the upgrade guard.

Authoring rules: [skill-guidelines.md](skill-guidelines.md). Philosophy: [skills-model.md](skills-model.md) § Testing.

| Tree | Framework | When |
|------|-----------|------|
| Host `src/` | vitest | Host-side reach-ins (routing, delivery, compose) |
| `container/agent-runner/src/` | `bun:test` | Container MCP tools, poll loop, providers |

## Production smoke (Cleo/Silas)

After major upgrades on production servers:

```bash
pnpm run post-upgrade -- --agent cleo --tier 1,2 --json-out /tmp/report.json
```

See [../.nanoclaw/post-upgrade.md](../.nanoclaw/post-upgrade.md) for tiers, SSH usage, and composition checks.

## Migration testing

v1→v2 migration development: [migration-dev.md](migration-dev.md).
