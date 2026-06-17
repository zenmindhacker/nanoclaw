# Admin CLI (`ncl`)

`ncl` queries and modifies the central DB — agent groups, messaging groups, wirings, users, roles, and more.

On the host it connects via Unix socket (`src/cli/socket-server.ts` at `data/ncl.sock`). Inside containers it uses the session DB transport (`container/agent-runner/src/cli/ncl.ts`).

```
ncl <resource> <verb> [<id>] [--flags]
ncl <resource> help
ncl help
```

## Resources

| Resource | Verbs | What it is |
|----------|-------|------------|
| groups | list, get, create, update, delete, restart, config get/update, config add-mcp-server/remove-mcp-server, config add-package/remove-package | Agent groups (workspace, personality, container config) |
| messaging-groups | list, get, create, update, delete | A single chat/channel on one platform |
| wirings | list, get, create, update, delete | Links a messaging group to an agent group (session mode, triggers) |
| users | list, get, create, update | Platform identities (`<channel>:<handle>`) |
| roles | list, grant, revoke | Owner / admin privileges (global or scoped to an agent group) |
| members | list, add, remove | Unprivileged access gate for an agent group |
| destinations | list, add, remove | Where an agent group can send messages |
| sessions | list, get | Active sessions (read-only) |
| user-dms | list | Cold-DM cache (read-only) |
| dropped-messages | list | Messages from unregistered senders (read-only) |
| approvals | list, get | Pending approval requests (read-only) |

## Container `cli_scope`

Controls what the agent can do with `ncl` from inside the container:

| Value | Behavior |
|-------|----------|
| `disabled` | Agent never learns about ncl. Host dispatch rejects `cli_request`. |
| `group` (default) | Scoped to own agent group: `groups`, `sessions`, `destinations`, `members` only. |
| `global` | Unrestricted. Set automatically for owner agent groups via `init-first-agent`. |

Managed via `ncl groups config get/update` and `container_configs` in the central DB.

## Container restart

```bash
ncl groups restart --id <group-id> [--rebuild] [--message <text>]
```

Kills running containers. With `--message`, writes an `on_wake` message and respawns. Without `--message`, containers return on the next user message.

From inside a container, `--id` is auto-filled and only the calling session restarts.

## OAuth repair (fork)

```bash
ncl oauth-health
ncl oauth-refresh-now
ncl oauth-refresh-one --id <registry-id>
```

See [oauth-hybrid-repair.md](oauth-hybrid-repair.md).

## Key files

- `src/cli/dispatch.ts` — dispatcher + approval handler
- `src/cli/crud.ts` — generic CRUD registration
- `src/cli/resources/` — per-resource definitions
