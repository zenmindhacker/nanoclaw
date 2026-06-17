# Fork Extensions (`src/extensions/`)

## Why this directory exists

Upstream (`nanocoai/nanoclaw`) ships a minimal host: channel infrastructure,
CLI, sweep, and module registries. All specific channel adapters and providers
live on long-lived branches (`channels`, `providers`) and are installed via
skills (`/add-slack`, `/add-opencode`).

This fork adds host-level code that upstream doesn't ship:
- OAuth token refresher (Google/Xero token rotation)
- Slack streaming enhancements (live DM composer, Thinking Steps cards)
- OAuth alert delivery to #sysops

Before creating `src/extensions/`, this code lived scattered in:
- `src/oauth-refresher.ts` / `src/oauth-alerts.ts` — imported directly in `src/index.ts`
- `src/channels/slack.ts` — in the channels barrel alongside upstream code

Both `src/index.ts` and `src/channels/index.ts` are files upstream actively
edits, so every upstream merge produced conflicts in those files.

## The solution

Move all fork-specific code into `src/extensions/**`. Upstream never edits
this directory. The only trunk touches required are:

1. **`src/index.ts`**: one import line + two call sites:
   ```typescript
   import { initExtensions, teardownExtensions } from './extensions/index.js';
   // in main():     initExtensions();
   // in shutdown(): teardownExtensions();
   ```

2. **`src/channels/index.ts`**: remove `import './slack.js'` (the Slack adapter
   now self-registers from the extensions barrel instead).

## Merge discipline

When resolving a conflict in `src/index.ts` after an upstream merge:
- Keep the `import './extensions/index.js'` line
- Keep the `initExtensions()` and `teardownExtensions()` calls
- Accept all new upstream imports and startup steps

When resolving a conflict in `src/channels/index.ts` after an upstream merge:
- Keep the comment noting Slack is registered by extensions
- Accept any new upstream channel barrel changes

Never add new fork host code directly to `src/index.ts`, `src/channels/index.ts`,
or other trunk files. Put it in `src/extensions/` and wire it through the barrel.

## Directory layout

```
src/extensions/
  index.ts            # Barrel: imports slack adapter + on-wake (side effects),
                      # exports initExtensions() / teardownExtensions()
  oauth/
    refresher.ts      # OAuth token refresh (host-side; containers read-only)
    alerts.ts         # Alert delivery to OAUTH_ALERT_SLACK_CHANNEL
  slack/
    adapter.ts        # Slack channel adapter (registerChannelAdapter side effect)
    on-wake.ts        # Router wake hooks → startSessionActivity / cancel on failure
```

Container-side fork extensions mirror the same pattern:

```
container/agent-runner/src/extensions/
  index.ts            # Barrel: imports slack/stream-progress (side-effect MCP registration)
  slack/
    stream-progress.ts              # report_stream_progress MCP tool
    stream-progress.instructions.md # CLAUDE.md fragment source
```

Wire container extensions with one trunk line in `mcp-tools/index.ts`:
`import '../extensions/index.js';`

Host wake hooks are registered from `src/extensions/slack/on-wake.ts` via
`registerOnWakeHook` / `registerOnWakeFailedHook` in trunk `router.ts` (generic
hook points only — no Slack-specific logic in router).

## What's NOT in extensions (and why)

| File | Location | Reason |
|------|----------|--------|
| `src/channels/slack-stream.ts` | `src/channels/` | Imported by core `src/channels/adapter.ts` |
| `src/channels/session-activity.ts` | `src/channels/` | Imported by `src/delivery.ts` and `src/channels/adapter.ts` |
| `src/transcription.ts` | `src/` | Imported by `src/channels/chat-sdk-bridge.ts` |
| `src/providers/opencode.ts` | `src/providers/` | Installed by `/add-opencode` skill; already follows the providers branch pattern |
| `container/agent-runner/src/extensions/**` | `container/agent-runner/src/extensions/` | Fork MCP tools; wired via `import '../extensions/index.js'` in `mcp-tools/index.ts` |

These files don't conflict in practice because upstream doesn't have them at all
in the upstream branch — they only conflict if upstream adds files at the same
paths, which it won't for Slack streaming or transcription.
