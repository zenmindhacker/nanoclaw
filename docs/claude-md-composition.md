# CLAUDE.md Composition

How agent instructions are assembled at container spawn. Implemented in `src/claude-md-compose.ts`, called from `src/container-runner.ts` on every spawn.

## Runtime instruction stack

```
Per-turn system prompt addendum     ← name, destinations, message rules (destinations.ts)
        ↓
/workspace/agent/CLAUDE.md          ← composed import-only entry (regenerated each spawn)
        ├── .claude-shared.md  →  /app/CLAUDE.md (container/CLAUDE.md)
        ├── @../global/CLAUDE.md     (persona, if exists)
        ├── @../global/CLAUDE.local.md (writable evolution, if exists)
        └── .claude-fragments/*.md   (MCP modules, skills, external MCP)
        ↓
/workspace/agent/CLAUDE.local.md  ← per-group memory (auto-loaded, writable)
/workspace/global/CLAUDE.local.md ← agent-wide memory (auto-loaded, writable)
        ↓
/home/node/.claude/skills/         ← symlinked skills (on-demand via /skill-name)
```

**Shared base** (`container/CLAUDE.md`) holds universal behavior: communication, memory layers, persistence discipline. **Persona** (`groups/global/CLAUDE.md`) holds identity and domain context. **Fragments** teach MCP tool usage. **Skills** load when invoked.

## Agent-global layer

`src/agent-global.ts` defines the shared identity mount at `/workspace/global/`:

| Path | Purpose |
|------|---------|
| `groups/global/CLAUDE.md` | Git-tracked persona (read-only in container) |
| `groups/global/CLAUDE.local.md` | Writable personality evolution |
| `groups/global/wiki/` | Unified knowledge base |
| `groups/global/mnemon/` | Unified memory graph |

`ensureAgentGlobalScaffold()` runs at compose time. `container-runner.ts` mounts `groups/global/` at `/workspace/global/` and sets `MNEMON_DATA_DIR=/workspace/global/mnemon`.

Multi-agent installs point `GROUPS_DIR` at `agents/cleo/groups` or `agents/silas/groups` — each gets its own global tree.

## Fragment discovery

On each spawn, `composeGroupClaudeMd()` builds `.claude-fragments/`:

| Source | Discovery | Fragment name |
|--------|-----------|---------------|
| Container skills | `container/skills/<name>/instructions.md` | `skill-<name>.md` |
| MCP tools | `container/agent-runner/src/mcp-tools/*.instructions.md` | `module-<name>.md` |
| Fork extensions | `container/agent-runner/src/extensions/**/*.instructions.md` | `module-<name>.md` |
| External MCP | `instructions` field in `container.json` | `mcp-<name>.md` (inline) |

Stale fragments are pruned; desired set is rewritten. `cli.instructions.md` is skipped when `cli_scope === 'disabled'`.

**TODO:** Compose currently links all skills with `instructions.md`; it does not yet respect per-group skill selection in `container.json`. Skill symlinks (`syncSkillSymlinks`) do respect selection.

## Skills vs fragments

| Mechanism | What it does |
|-----------|--------------|
| **Fragments** | Always-on instructions inlined via composed `CLAUDE.md` imports |
| **Skill symlinks** | On-demand capability at `/home/node/.claude/skills/<name>/` |

Most container skills ship only `SKILL.md` (wiki, mnemon, self-customize) — they are **not** composed into `CLAUDE.md` unless they also have `instructions.md`.

## Composed entry format

```markdown
<!-- Composed at spawn — do not edit. Per-group: CLAUDE.local.md. Agent-wide: groups/global/CLAUDE.local.md + wiki/. -->
@./.claude-shared.md
@../global/CLAUDE.md
@../global/CLAUDE.local.md
@./.claude-fragments/module-core.md
...
```

Edit `CLAUDE.local.md` for per-group memory. Edit `groups/global/CLAUDE.local.md` for cross-group evolution. Never hand-edit composed `CLAUDE.md` — it is regenerated on spawn.

## Startup migration

`migrateGroupsToClaudeLocal()` (host boot) renames legacy per-group `CLAUDE.md` → `CLAUDE.local.md` and removes old `.claude-global.md` symlinks.

## Post-upgrade validation

Tier 1 of `pnpm run post-upgrade` checks composition and memory scaffold. See [../.nanoclaw/post-upgrade.md](../.nanoclaw/post-upgrade.md).
