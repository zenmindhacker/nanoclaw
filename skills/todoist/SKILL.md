---
name: todoist
description: Query and manage Cian's Todoist tasks and projects, including personal tasks and Connected Tutoring (Christina) tasks.
homepage: https://todoist.com
metadata: {"clawdis":{"emoji":"✅","requires":{}}}
---

# Todoist

Todoist REST API v2 CLI. Manages Cian's personal tasks and Connected Tutoring tasks (with Christina).

**Script:** `{baseDir}/scripts/todoist.sh` (Node.js v22+ native TypeScript)

## Credentials

Token stored at: `{baseDir}/credentials` (or set `TODOIST_API_KEY` env var)

## Running

```bash
node --experimental-strip-types {baseDir}/scripts/todoist.ts <command> [options]
# or via wrapper:
{baseDir}/scripts/todoist.sh <command> [options]
```

## Commands

### List Tasks

```bash
# All active tasks (grouped by project)
todoist.sh list

# Today + overdue
todoist.sh today

# Filter by project (partial name match)
todoist.sh list --project "Connected Tutoring"
todoist.sh list --project inbox

# Filter by label
todoist.sh list --label "@cian"

# Todoist filter string
todoist.sh list --filter "p1"
todoist.sh list --filter "today & #Connected Tutoring"
todoist.sh list --filter "overdue | today"

# JSON output
todoist.sh list --json
```

### Get / Create / Update

```bash
# Get task detail
todoist.sh get <task-id>

# Create a task
todoist.sh create "Follow up with Christina on curriculum"
todoist.sh create "Review weekly report" --project "Connected Tutoring" --due "Friday" --priority p2
todoist.sh create "Renew passport" --due "2026-06-01" --label "admin"

# Update a task
todoist.sh update <task-id> --due "next Monday" --priority p1
todoist.sh update <task-id> --title "New title"

# Complete / delete
todoist.sh complete <task-id>
todoist.sh delete <task-id>
```

### Projects & Structure

```bash
# List all projects
todoist.sh projects

# Create a project
todoist.sh add-project "Q2 Goals"

# List sections in a project
todoist.sh sections "Connected Tutoring"

# Comments
todoist.sh comments <task-id>
todoist.sh add-comment <task-id> "Note here"
```

## Priority Reference

| Flag | Level | Use for |
|------|-------|---------|
| p1   | Urgent 🔴 | Must do today, blocking |
| p2   | High 🟠   | Important this week |
| p3   | Medium 🟡 | This month / normal |
| p4   | Low        | Someday, no rush |

## Useful Todoist Filters

| Filter | Meaning |
|--------|---------|
| `today` | Due today |
| `overdue` | Overdue |
| `p1` | Priority 1 only |
| `#inbox` | Inbox project |
| `@label` | By label |
| `today & #Connected Tutoring` | Today in a specific project |
| `!subtask` | Exclude subtasks |
