# Agent-Created Skill Lifecycle (Phase 5 Design)

Based on microclaw's skill auto-improvement system ([PR #329](https://github.com/microclaw/microclaw/pull/329)), ported to NanoClaw's host/container split and git-backed skill model.

> **Status:** Design only. Tiers are independent — Tier 1 (audit/archive) is lowest-risk and highest-ROI.

---

## Motivation

NanoClaw's current skill model is static: skills are created manually, never pruned, and injected into every prompt regardless of relevance. As agent skill counts grow, prompt bloat increases and relevance degrades. microclaw showed that three layered improvements — deterministic audit/archive, retrieval-gated catalog, and autonomous end-of-turn review — address this efficiently.

---

## Agent-Created Skill Convention

All three tiers depend on a stable on-disk convention for skills that agents create vs skills that humans maintain.

### Directory layout

```
groups/<folder>/skills/           # per-agent-group skill root
  <name>/
    SKILL.md                      # required: frontmatter + body
    [optional runtime files]
  .archived/                      # auto-archived stale skills
    <name>-<timestamp>/
      SKILL.md
      [runtime files]
```

The group `skills/` directory is created under `GROUPS_DIR/<folder>/` alongside existing group files (CLAUDE.md, CLAUDE.local.md, wiki/). The host mounts it alongside the group dir.

### Container path

The host already mounts `groups/<folder>/` to `/workspace/agent` (RW). The group `skills/` is therefore at `/workspace/agent/skills/` inside the container — no new mount needed.

### SKILL.md frontmatter schema

All skills must have YAML frontmatter. Agent-created skills are identified by `source: agent-created`:

```yaml
---
name: <slug>                      # unique within this group; no spaces
description: <one sentence>       # used for top-K retrieval scoring
source: agent-created             # or: human (never auto-archived)
version: 1                        # bumped on each patch
created_at: YYYY-MM-DD
last_used: YYYY-MM-DD             # updated by activation logging
---
```

Human/operator skills (`source: human`) are never archived or modified by the auto-improvement pipeline. Only `source: agent-created` skills are eligible for patching, archiving, or deletion.

### Cap

Maximum 20 `agent-created` skills per agent group (`MAX_AGENT_CREATED_SKILLS`). Enforcement happens in the audit (`ncl skills audit`) and the Tier 3 review gate before creating new skills.

---

## Tier 1 — Deterministic Audit + Archive (implement first)

No LLM calls. Closes "skills pile up forever."

### Central DB migration

New table: `skill_activation_logs`

```sql
CREATE TABLE skill_activation_logs (
  id          INTEGER PRIMARY KEY,
  agent_group_id TEXT NOT NULL,
  skill_name  TEXT NOT NULL,
  session_id  TEXT,
  activated_at TEXT NOT NULL
);
CREATE INDEX idx_sal_agent_skill ON skill_activation_logs(agent_group_id, skill_name);
```

**Files:**
- `src/db/migrations/016-skill-activation-logs.ts`

**Activation logging trigger:** When the container's poll loop executes a tool call against a skill script path under `/workspace/agent/skills/<name>/`, or when the agent uses the `create-skill` skill to create a new agent-created skill, log an activation row via the `outbound.db` system action → host sweep reads it.

### `ncl skills audit`

New CLI command. No LLM. Reports:

| Issue | Detection | Threshold |
|-------|-----------|-----------|
| Near-duplicate | Token Jaccard similarity ≥ 0.5 on `name + description` | warn |
| Thin body | `SKILL.md` body < 80 chars | warn |
| Stale | `source: agent-created` + `last_used` > 30 days ago | warn |
| Cap headroom | Count agent-created in group vs `MAX_AGENT_CREATED_SKILLS=20` | warn at 15+ |

Output example:
```
groups/main/skills audit (8 agent-created, 12 cap headroom):
  WARN  linear-search-helper  near-duplicate of linear-create-issue (Jaccard 0.62)
  WARN  old-xero-helper       stale: last used 2026-03-01 (78 days)
  OK    cycle-brief-formatter
```

**Files:**
- `src/cli/resources/skills.ts` — new resource
- `src/cli/resources/index.ts` — register skills resource

### Archive sweep in host-sweep

Every N sweeps (configurable, default daily via a counter), scan each active agent group's `skills/` directory:

**Archive rule:** `source: agent-created` AND `last_used` older than `SKILL_ARCHIVE_AFTER_DAYS` (default 30) AND no activation since cutoff AND SKILL.md mtime > 7 days (grace period for newly created skills).

**Action:** `fs.renameSync(skillDir, archivedDir)` where `archivedDir = .archived/<name>-<ISO-timestamp>`.

**Config:**
```
SKILL_ARCHIVE_AFTER_DAYS=30    # 0 disables archive sweep
MAX_AGENT_CREATED_SKILLS=20
```

**Files:**
- `src/host-sweep.ts` — add archive sweep call
- `src/modules/skills/archive.ts` — archive logic
- `src/db/session-db.ts` — `getLastSkillActivation(agentGroupId, skillName)` helper

---

## Tier 2 — Retrieval-Gated Catalog (implement after Tier 1)

Reduces prompt bloat when skill count grows. Claude-md-compose currently includes ALL `instructions.md` fragments — no relevance filtering.

### Token-overlap scorer

```typescript
// src/modules/skills/catalog.ts
export function scoreSkillForQuery(skill: { name: string; description: string }, query: string): number {
  const queryTokens = tokenize(query);
  const skillTokens = tokenize(`${skill.name} ${skill.description}`);
  const intersection = queryTokens.filter(t => skillTokens.has(t)).length;
  return intersection / (queryTokens.size + skillTokens.size - intersection); // Jaccard
}

export function buildCatalogForQuery(skills: Skill[], query: string, topK = 3): {
  inlined: Skill[];   // full body, score > 0
  compact: Skill[];   // name + description only
}
```

### Claude-md-compose integration

`composeGroupClaudeMd()` in `src/claude-md-compose.ts` currently creates symlinks to ALL skill `instructions.md` fragments.

Enhancement: Accept `lastUserMessage?: string` (looked up from the session's `inbound.db` most recent message). Pass through the scorer to filter the skill fragment set. Inline top-K full bodies; compact-list the rest.

This also fixes the existing TODO in `claude-md-compose.ts`:
> `// TODO (shared-source refactor): respect container.json skill selection.`

### OpenCode parity

`opencode.ts` in the container provider passes `instructions: [...]` file paths. With Tier 2, the scored catalog snippet (inline top-K + compact list) is passed as an additional `instructions` entry or as part of `wrapPromptWithContext`.

### Config
```
SKILLS_CATALOG_TOP_K=3         # number of skills to inline in full
```

**Files:**
- `src/modules/skills/catalog.ts` — scorer
- `src/claude-md-compose.ts` — query-aware compose
- `container/agent-runner/src/providers/opencode.ts` — pass catalog to instructions

---

## Tier 3 — Autonomous End-of-Turn Review (implement after Tier 2)

The Hermes "auto-generates skills" claim. Highest value, highest risk.

### Trigger (ported from microclaw's `skill_review.rs`)

After a turn completes, queue a background review if:
1. Turn used ≥ `SKILL_REVIEW_MIN_TOOL_CALLS` tool calls (default: 5)
2. `assess_success()` returns non-`Unlikely` — heuristics:
   - Final turn has non-empty text output
   - Tool error rate < 50% of tool calls
   - No apologetic/circuit-breaker phrases in final output
3. `agent-created` skill count < `MAX_AGENT_CREATED_SKILLS` (20)
4. Tool trajectory is non-trivial (not all read-only, not empty)

### LLM review call

A **cheap worker model** (OpenCode Go DeepSeek flash, via the existing `delegate` pattern) reviews the tool trajectory and returns a JSON verdict:

```json
{
  "action": "create" | "edit" | "patch" | "none",
  "skill_name": "slug-name",
  "description": "one sentence description",
  "reason": "why this is worth distilling",
  "content": "full SKILL.md body (for create/edit) or patch object (for patch)"
}
```

### Approval model

Default: **stage all writes** as `pending_approvals` (like the existing `install_packages` self-mod flow). The operator approves/rejects via the standard approval mechanism.

Config option: `SKILL_AUTO_APPLY_PATCH=false` (default). When `true`, `patch` actions under cap apply automatically without approval (lower-risk than `create`/`edit`).

### Apply flow

`src/modules/skills/apply.ts` (mirrors `src/modules/self-mod/apply.ts`):

1. Parse `action` from LLM verdict
2. **Create:** Validate frontmatter, injection scan (port patterns from microclaw's `memory_quality.rs`), write `groups/<folder>/skills/<name>/SKILL.md`
3. **Edit:** Full rewrite with safety checks
4. **Patch:** Single-match patch (one `search_text`, one `replace_text`); injection scan; bump `version`
5. After write: log activation, trigger container restart (optional)

### MCP `skill_manage` tool

Container-side (mirrors microclaw's `skill_manage` tool):

```typescript
// container/agent-runner/src/mcp-tools/skill-manage.ts
{
  name: 'skill_manage',
  description: 'Create, edit, patch, or delete an agent-created skill in this group.',
  inputSchema: {
    action: 'create' | 'edit' | 'patch' | 'delete',
    name: string,
    description?: string,
    content?: string,
    search_text?: string,   // for patch
    replace_text?: string,  // for patch
  }
}
```

Agent writes are always staged via the approval system. The tool returns the approval ID, not the written file.

### Injection scan

Port microclaw's `memory_quality.rs` patterns to `src/modules/skills/injection-scan.ts`:

- Invisible unicode (zero-width chars, RTL overrides)
- Instruction override patterns (`ignore previous instructions`, `disregard the above`)
- Exfiltration patterns (curl/wget with external URLs to non-whitelisted hosts)

### Open questions

| Question | Default recommendation |
|----------|----------------------|
| Auto-apply patch under cap? | `false` (always approve) until trust established |
| Git commit agent-created skills? | No auto-commit; stays server-local until operator promotes with `git add -f` |
| Agent-created skills in global persona vs group? | Group only (`groups/<folder>/skills/`) — no global pollution |
| Review worker model | `opencode-go/deepseek-v4-flash` (cheapest capable model) |

---

## Implementation dependency graph

```
Tier 1: audit + archive + activation logging
    ↓
Tier 2: retrieval-gated catalog (fixes claude-md-compose TODO)
    ↓
Tier 3: end-of-turn review + apply + skill_manage MCP
    ↓
MCP skill_manage with approval (Tier 3b)
```

Tier 1 can start any time after this design is agreed. Tier 3 should not start until mnemon is verified in production (mnemon holds facts; skill review distills procedures — the boundary needs to be working before auto-creation is safe).

---

## Files to create/modify (summary)

| File | Tier | Action |
|------|------|--------|
| `src/db/migrations/016-skill-activation-logs.ts` | 1 | create |
| `src/modules/skills/audit.ts` | 1 | create |
| `src/modules/skills/archive.ts` | 1 | create |
| `src/cli/resources/skills.ts` | 1 | create |
| `src/cli/resources/index.ts` | 1 | modify (add skills) |
| `src/host-sweep.ts` | 1 | modify (add archive call) |
| `src/modules/skills/catalog.ts` | 2 | create |
| `src/claude-md-compose.ts` | 2 | modify (query-aware) |
| `container/agent-runner/src/providers/opencode.ts` | 2 | modify (catalog) |
| `src/modules/skills/injection-scan.ts` | 3 | create |
| `src/modules/skills/apply.ts` | 3 | create |
| `src/modules/skills/review-queue.ts` | 3 | create |
| `container/agent-runner/src/mcp-tools/skill-manage.ts` | 3 | create |
