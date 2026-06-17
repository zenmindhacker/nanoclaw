# OAuth Hybrid Repair

NanoClaw uses a hybrid OAuth repair model:

- The **host** is the only writer for OAuth token JSON files.
- Cleo can **inspect, retry, and report** OAuth health through host-side `ncl` commands.
- `#sysops` receives host refresh failure alerts and Cleo health-check reports.

This preserves the credential boundary while keeping OAuth failures visible in the normal agent workflow.

## Ownership

OAuth token files live under:

```bash
~/.config/nanoclaw/credentials/services/
```

The host process refreshes those files via `src/oauth-refresher.ts`. Containers mount the files read-only at:

```bash
/workspace/extra/credentials/
```

Agents should read those files when a skill needs them, but should not write them. If a token needs repair, Cleo asks the host to refresh it through `ncl`.

## Alerting

`src/index.ts` starts the refresher with an `onAlert` callback. Refresh failures, missing client credentials, and missing refresh tokens are delivered to Slack through the normal delivery adapter.

Default target:

```bash
OAUTH_ALERT_SLACK_CHANNEL=slack:C07F195GB96
```

Set that env var to override the sysops destination.

Successful refreshes are log-only to avoid noisy Slack messages. Check `logs/nanoclaw.log` for normal refresh activity and `logs/nanoclaw.error.log` for failures.

## Cleo Repair Commands

The host exposes OAuth repair through `ncl`:

```bash
pnpm run ncl oauth-health
pnpm run ncl oauth-refresh-now
pnpm run ncl oauth-refresh-one --id xero
```

From inside an agent container, Cleo can use the same command names through the container `ncl` transport, subject to the group's `cli_scope`.

Command behavior:

- `oauth-health` returns registry token status from `getTokenHealth()`.
- `oauth-refresh-now` asks the host to refresh all registry tokens immediately.
- `oauth-refresh-one --id <registry-id>` asks the host to refresh one token.

The host performs the file writes in all cases.

## Scheduled Health Check

The legacy v1 `oauth-token-refresh` task must not be recovered. It refreshed tokens from inside the agent container and duplicates the host refresher.

Use the v2 read-only task instead:

```bash
pnpm exec tsx scripts/seed-scheduled-tasks.ts
```

The `oauth-health-check` manifest entry targets Cleo's `slack_scheduled` group and runs `agents/cleo/groups/slack_scheduled/oauth-health-gate.sh`.

The gate only wakes Cleo when token files are expired, malformed, or missing required refresh data. When Cleo wakes, the prompt tells her to:

1. Run `ncl oauth-health`.
2. Post a concise status to `#sysops` if anything is unhealthy.
3. Run `ncl oauth-refresh-now`.
4. Escalate manual re-auth if refresh still fails.

Healthy checks exit silently.

## Manual Recovery

If OAuth-backed skills are failing:

1. Check health:

   ```bash
   pnpm run ncl oauth-health
   ```

2. Try a host-side refresh:

   ```bash
   pnpm run ncl oauth-refresh-now
   ```

3. For one token:

   ```bash
   pnpm run ncl oauth-refresh-one --id <registry-id>
   ```

4. If the provider returns `invalid_grant`, a missing refresh token, or equivalent permanent auth failure, re-run the provider's OAuth flow on the host and update `oauth-registry.json` / token files as needed.

## Invariants

- Do not make `/workspace/extra/credentials` writable just to fix OAuth refresh.
- Do not seed or import legacy `oauth-token-refresh`.
- Do not run a second refresh loop from a scheduled task.
- If a credential is broken, Cleo reports and triggers host repair; the host mutates token JSON.
