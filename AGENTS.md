# AGENTS.md

Project-level context lives in [CLAUDE.md](CLAUDE.md) (architecture, entity model, two‑DB
split, `ncl` CLI, container config, gotchas) and [README.md](README.md). Read those first.
Standard dev commands are in `package.json` scripts and the "Development" section of
`CLAUDE.md` — don't duplicate them here.

## Cursor Cloud specific instructions

NanoClaw is a Node/pnpm **host** that orchestrates **per‑session agent containers** (Bun
runtime) over Docker. The full message loop is:
`CLI/channel → host router → inbound.db → container (agent-runner) → outbound.db → host delivery → channel`.

The update script only refreshes **codebase deps** (`pnpm install`, and `bun install`
under `container/agent-runner` when Bun is present). Everything below is the durable,
non‑obvious context needed to *run* and *test* in this VM — none of it belongs in the
update script.

### Lint / test / build (host)
- Use the `package.json` scripts: `pnpm run lint`, `pnpm test` (vitest), `pnpm run build` (tsc), `pnpm run typecheck`.
- `pnpm run lint` currently reports ~13 **pre‑existing** errors and ~100 warnings in
  committed `src/` files (unused vars, `require()` imports, empty blocks). These are not
  caused by setup — don't "fix" them as part of unrelated work.

### Container-runner (Bun, separate tree)
- `container/agent-runner/` is **Bun-managed** (`bun.lock`) — never run `pnpm install` there.
- Tests/typecheck: `cd container/agent-runner && bun test` and `bun run typecheck`.
- The agent-runner **source** is bind‑mounted read‑only into every container at `/app/src`,
  so source-only edits do **not** need an image rebuild — but a **running** container has
  already imported the old module: stop it (`docker stop <name>`) so the host respawns a
  fresh one. Dependency changes (editing `container/agent-runner/package.json`) require
  `bun install` **and** an image rebuild.

### Services that must be running to spawn containers
These are not started by the update script; bring them up at session start:

1. **Docker daemon.** The host calls `docker info` at boot and aborts with a FATAL error if
   it can't reach the runtime. If `docker info` fails, start it and make the socket usable
   by the non‑root user, e.g.: `sudo dockerd >/tmp/dockerd.log 2>&1 &` then
   `sudo chmod 666 /var/run/docker.sock`. The daemon is configured for `fuse-overlayfs`
   (see `/etc/docker/daemon.json`) because the VM kernel lacks full overlay2 support.
2. **Agent container image.** Build once with `./container/build.sh`. The image name is
   per‑checkout (derived from the repo path via `setup/lib/install-slug.sh`, e.g.
   `nanoclaw-agent-v2-<hash>:latest`), so `docker images` won't show a plain
   `nanoclaw-agent`. Rebuild only when `container/Dockerfile` changes.
3. **OneCLI gateway (mandatory).** `src/container-runner.ts` calls
   `onecli.applyContainerConfig(...)` and **refuses to spawn a container** if the gateway
   isn't applied — this is true even for the `mock` provider. Start the local gateway with
   `ONECLI_BIND_HOST=<vm-ip> ONECLI_VERSION=1.23.0 curl -fsSL onecli.sh/install | sh`
   (it runs `onecli` + `postgres` via docker‑compose; compose file at `~/.onecli/`). It
   needs a bind host it can advertise — `127.0.0.1` is rejected; use the VM IP from
   `hostname -I`. Put the resulting URL in `.env` as `ONECLI_URL=http://<vm-ip>:10254`.
   A freshly installed gateway accepts the host SDK with **no** `ONECLI_API_KEY`.

### Running the host and a "hello world"
- Start the host in dev with hot reload: `pnpm run dev` (reads `.env`). `.env` is
  git‑ignored — recreate it with at least `ONECLI_URL=...`.
- **Running without Anthropic credentials:** set `NANOCLAW_DEFAULT_PROVIDER=mock` in `.env`.
  The `mock` agent provider returns canned text so the full loop runs without a real LLM
  key. Caveat: the agent-runner only **delivers** replies wrapped in
  `<message to="<destination>">…</message>` blocks; the stock `mock` echoes the prompt and
  therefore is processed but not delivered. To prove delivery end‑to‑end you need either a
  real provider (Anthropic key via OneCLI / `claude` provider) or a temporary tweak to the
  mock to emit an addressed block (revert before committing).
- Wire a local CLI agent (no channel credentials needed):
  `pnpm exec tsx scripts/init-cli-agent.ts --display-name Tester --agent-name Andy`,
  then talk to it: `pnpm run chat "hello"`. The CLI channel uses the Unix socket
  `data/cli.sock`; the destination name for the local CLI session is `local-cli`.

### Working‑tree gotcha
- Booting the host runs an idempotent migration that **renames the tracked
  `groups/main/CLAUDE.md` → `groups/main/CLAUDE.local.md`**. This dirties git on every run.
  Restore it (`git checkout -- groups/main/CLAUDE.md`) before committing, or point the host
  at scratch dirs via `GROUPS_DIR`/`DATA_DIR` env vars. Runtime state under `data/`,
  `logs/`, `groups/*`, and `.heartbeat` is git‑ignored / should not be committed.
