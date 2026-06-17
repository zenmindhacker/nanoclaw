# Fork Extensions

How customized NanoClaw installs (e.g. Cleo/Silas) keep fork-specific code out of upstream merge paths.

Full merge discipline: [`.nanoclaw-migrations/extensions.md`](../.nanoclaw-migrations/extensions.md).

## Why

Upstream (`nanocoai/nanoclaw`) ships registry and infrastructure only. Channel adapters and providers install via skills. Fork-specific host code (OAuth refresh, Slack streaming, etc.) would conflict in `src/index.ts` and `src/channels/index.ts` on every upstream pull if left scattered in trunk paths.

## Host extensions (`src/extensions/`)

Upstream never edits this directory.

```
src/extensions/
  index.ts              # Barrel: side-effect imports + initExtensions()
  oauth/
    refresher.ts        # Token refresh (host-side)
    alerts.ts           # Alert delivery to OAUTH_ALERT_SLACK_CHANNEL
  slack/
    adapter.ts          # Slack channel adapter (self-registers)
    on-wake.ts          # Router wake hooks → startSessionActivity
```

**Trunk touch points** (generic only):

1. `src/index.ts` — `import { initExtensions, teardownExtensions } from './extensions/index.js'`
2. `src/router.ts` — `registerOnWakeHook` / `registerOnWakeFailedHook` (no Slack logic in router)

## Container extensions (`container/agent-runner/src/extensions/`)

Fork MCP tools that are not upstream trunk tools:

```
container/agent-runner/src/extensions/
  index.ts
  slack/
    stream-progress.ts              # report_stream_progress MCP tool
    stream-progress.instructions.md
```

Wired via one line in `mcp-tools/index.ts`: `import '../extensions/index.js'`.

## What stays outside extensions

| File | Location | Reason |
|------|----------|--------|
| `slack-stream.ts`, `session-activity.ts` | `src/channels/` | Imported by core `delivery.ts` / `adapter.ts` |
| `transcription.ts` | `src/` | Imported by `chat-sdk-bridge.ts` |
| `providers/opencode.ts` | `src/providers/` | Installed by `/add-opencode` skill |

These files don't conflict with upstream because upstream doesn't ship them at those paths.

## Merge discipline

When resolving `src/index.ts` conflicts after upstream merge:
- Keep the `extensions/index.js` import and `initExtensions()` / `teardownExtensions()` calls
- Accept new upstream imports and startup steps

Never add new fork host code directly to trunk files. Put it in `src/extensions/` and wire through the barrel.

## Replay on clean upstream

See [`.nanoclaw-migrations/guide.md`](../.nanoclaw-migrations/guide.md) for the full file inventory.
