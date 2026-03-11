---
name: linear
description: Query and manage Linear issues, projects, milestones, and team workflows across multiple orgs.
homepage: https://linear.app
metadata: {"clawdis":{"emoji":"📊","requires":{"env":["LINEAR_API_KEY_COGNITIVE"]}}}
---

# Linear

Multi-org Linear CLI backed by the GraphQL API with full type safety, local caching, and support for Ganttsy, CognitiveTech, and CopperTeams.

**Script:** `{baseDir}/scripts/linear.ts` (Node.js v25 native TypeScript)  
**Router:** `{baseDir}/scripts/linear-router.sh` (org aliasing + create-smart)

## Supported Orgs

| Key | Alias | Team | Default Project | Env Var |
|-----|-------|------|-----------------|---------|
| `cog` | cognitive, cognitive-tech, ctci | COG | OpenClaw | `LINEAR_API_KEY_COGNITIVE` |
| `ct` | copperteams, copper | KOR | Kora Voice Integration | `LINEAR_API_KEY_CT` |
| `gan` | ganttsy | GAN | Ganttsy MVP | `LINEAR_API_KEY_GANTTSY` |

Add new orgs in the `ORG_CONFIGS` map at the top of `linear.ts`.

## Setup (first time per org)

```bash
# Initialize cache — fetches team, project, users, states, labels
node --experimental-strip-types {baseDir}/scripts/linear.ts --org cog init

# Or via router
linear-router cog init
```

Cache is stored per-org at `{baseDir}/.cache/<org>.json`.  
Re-run `init --force` to refresh.

During `init`, the **current milestone** is auto-detected as the milestone with the nearest upcoming `targetDate`. This becomes the default for all `create` calls unless overridden.

## Running

```bash
# Direct
node --experimental-strip-types {baseDir}/scripts/linear.ts --org <org> <command> [options]

# Via router (recommended — handles org aliasing and create-smart)
linear-router <org> <command> [options]

# Org from env (skip --org flag)
LINEAR_ORG=cog node --experimental-strip-types {baseDir}/scripts/linear.ts <command>
```

## Commands

### Browse & Search

```bash
# List issues (defaults to project scope)
linear-router cog list
linear-router cog list --status "In Progress"
linear-router cog list --no-backlog --limit 50
linear-router cog list --json

# Search by text
linear-router cog find "auth bug"
linear-router cog find "auth" --in title
linear-router cog find "timeout" --status "In Progress" --json

# Get full issue detail
linear-router cog get COG-42
linear-router cog get COG-42 --json

# My in-progress issues (router shorthand)
linear-router cog my

# Project stats
linear-router cog stats
linear-router cog stats --json
```

### Create & Update

```bash
# Create an issue
# Default project, status (Todo), and current milestone are applied automatically
linear-router cog create "Fix auth timeout" -d "Users getting logged out after 5 min"
linear-router cog create "Build dashboard" -p high -s todo -l "Feature,Frontend"
linear-router cog create "Sub-task" --parent COG-10 -e 3
linear-router cog create "Due soon" --due 2026-03-01 -a "cian@..."
linear-router cog create "Spike" --no-milestone   # skip default milestone
linear-router gan create "Admin task" --project "Ganttsy Admin"  # override default project

# Smart create — uses org profile defaults, dry-run by default
linear-router gan create-smart "Implement X" "Context..." --priority high
linear-router gan create-smart "Implement X" "Context..." --yes   # actually creates
linear-router gan create-smart "Hire designer" "Job posting" --project "Ganttsy Admin" --assignee bart@ganttsy.com --yes

# Update an issue
linear-router cog update COG-42 --title "New title"
linear-router cog update COG-42 -s done -p urgent
linear-router cog update COG-42 --assignee "cian@..." -e 5 --due 2026-03-15

# Add a comment
linear-router cog comment COG-42 "Blocked on API access"
```

### Status & Priority Shorthands

```bash
linear-router cog update COG-42 -s progress   # In Progress
linear-router cog update COG-42 -s done
linear-router cog update COG-42 -s blocked
linear-router cog update COG-42 -s todo
linear-router cog update COG-42 -s backlog
linear-router cog update COG-42 -s review     # In Review

linear-router cog update COG-42 -p urgent
linear-router cog update COG-42 -p high
linear-router cog update COG-42 -p medium
linear-router cog update COG-42 -p low
```

### Milestones

```bash
linear-router cog milestones list
linear-router cog milestones list --json

linear-router cog milestones create "Beta Launch" --date 2026-04-01
linear-router cog milestones create "Alpha" -d "Internal test" --date 2026-03-01

linear-router cog milestones update <milestone-id> --name "Renamed" --date 2026-05-01

# Assign an issue to a milestone during create/update
linear-router cog create "Feature" -m "Beta Launch"
linear-router cog update COG-42 -m "Beta Launch"
```

### Batch Operations

```bash
# Bulk status change (dry-run by default)
linear-router cog batch update-status --status done --filter-status "In Review"
linear-router cog batch update-status --status backlog --filter-title "spike" --dry-run
linear-router cog batch update-status --status done --filter-labels "Sprint-1" --execute

# Bulk label add
linear-router cog batch add-labels COG-1,COG-2,COG-3 --labels "Sprint-2"

# Bulk assign
linear-router cog batch assign COG-1,COG-2 --assignee "cian@..."
```

### Git / Branch Name

```bash
# Get Linear-standard branch name for an issue
linear-router cog get COG-42 --json | jq -r '.identifier + "-" + (.title | ascii_downcase | gsub("[^a-z0-9]"; "-"))'

# Or use the branch output from the original script (router passthrough):
# dev/cog-42-fix-auth-timeout-bug
```

## Git Workflow (Linear ↔ GitHub)

**Always use Linear-derived branch names** to keep GitHub and Linear in sync automatically.

```bash
ISSUE="COG-42"
BRANCH="dev/cog-42-fix-auth-timeout-bug"   # from get --json above

cd ~/workspace/cognitive-tech
git checkout main && git pull origin main
git worktree add .worktrees/${ISSUE,,} -b "$BRANCH" origin/main
cd .worktrees/${ISSUE,,}

# ... make changes ...
git add -A && git commit -m "fix: $ISSUE"
git push -u origin "$BRANCH"
gh pr create --title "$ISSUE: Fix auth timeout" --body "Closes $ISSUE"
```

- PR created from a Linear branch → issue moves to **In Review** automatically
- PR merged → issue moves to **Done** automatically

## Router: `linear-router.sh`

The router wraps `linear.ts` with org aliases and convenience commands:

```bash
linear-router <org> my              # your In Progress issues
linear-router <org> repo            # print local repo path for this org
linear-router <org> defaults        # show org's create-smart profile
linear-router <org> create-smart "Title" ["Desc"] [--yes] [--project X] [--labels X] [--priority X] [--state X] [--assignee X]
linear-router <org> <any linear.ts command>   # pass-through
```

## Priority Reference

| Level | Linear value | Use for |
|-------|-------------|---------|
| urgent | 1 | Production issues, blockers |
| high | 2 | This week, important |
| medium | 3 | This sprint/cycle |
| low | 4 | Nice to have |
| none | 0 | Backlog, someday |

## JSON Output for AI Workflows

Every read command supports `--json` for structured output:

```bash
# Pipe to jq or pass to another agent
linear-router cog list --status "In Progress" --json | jq '.[].identifier'
linear-router cog get COG-42 --json
linear-router cog stats --json
linear-router cog milestones list --json
```

## Adding a New Org

1. Add API key to `~/.openclaw/.env`: `LINEAR_API_KEY_MYORG=lin_api_...`
2. Add entry to `ORG_CONFIGS` in `linear.ts`:
   ```typescript
   myorg: { apiKeyEnv: 'LINEAR_API_KEY_MYORG', teamKey: 'MYO', defaultProject: 'My Project' },
   ```
3. Add aliases in `ORG_ALIASES` and the `linear-router.sh` case statement.
4. Run `linear-router myorg init` to build the cache.

## Notes

- Cache is per-org at `{baseDir}/.cache/<org>.json`
- Run `init --force` any time team membership, projects, or labels change
- GraphQL variables used throughout — no string interpolation, no escaping issues
- `--experimental-strip-types` flag required for Node v22–v24; native on v25+
