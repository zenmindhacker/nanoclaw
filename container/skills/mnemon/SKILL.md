---
name: mnemon
description: Persistent knowledge graph memory. Recall past context before tasks, remember facts after decisions. Use when the user references something from a previous session, or after any durable decision or preference is expressed.
---

# Mnemon — Persistent Memory

Mnemon is a four-graph knowledge store (`remember / link / recall / status`).
Your memory survives container restarts and session boundaries.

Under the **OpenCode provider** (Kimi / DeepSeek), the `readMnemonContext()`
injection already runs `mnemon recall` at the start of each prompt and prepends
the guide. You still call mnemon explicitly when the injected recall wasn't
specific enough, or after substantive turns.

## When to recall

Before tasks where past context could change your approach:
- User references a project, person, or convention you've worked with before
- Starting a complex multi-step task where prior decisions matter
- User asks "do you remember…" or "last time we…"

```bash
mnemon recall "linear project conventions"
mnemon recall "xero invoice workflow"
mnemon recall "Cian preferences for briefings"
```

## When to remember

After turns where something durable was learned or decided:
- User states a preference: "I prefer X over Y"
- You learn a fact about their environment, projects, or workflow
- A complex task is completed with a pattern worth reusing
- User explicitly asks you to remember something

Keep entries short and factual — one or two sentences max:

```bash
mnemon remember "Cian prefers morning briefings at 9am ET. Cycle briefing sends to Christina's Slack DM."
mnemon remember "NVS invoice script: skills/invoice-generator/scripts/nvs-processor.mjs. Run monthly on Xero."
mnemon remember "Linear workspace: Cognitivetech. Ganttsy integration via skills/ganttsy-resume/"
```

## When to link

For relationships between entities:

```bash
mnemon link "Cian" "is owner of" "Cognitivetech"
mnemon link "xero-token" "expires every" "30 minutes"
```

## Status and inspection

```bash
mnemon status          # show graph stats + active store
mnemon recall "."      # broad recall of recent/common facts
```

## What belongs in mnemon vs CLAUDE.local.md

| Store | Use for |
|-------|---------|
| **mnemon** | Episodic facts, preferences, decisions, entity relationships, lessons learned |
| **CLAUDE.local.md** | Procedural conventions, workflow schemas, persistent instructions, tool configs |

Do **not** duplicate long-form procedures into mnemon — the graph is for facts,
not documentation. If it's more than two sentences, it belongs in CLAUDE.local.md
or the wiki.

## OpenCode-specific note

mnemon hooks don't fire under OpenCode. The `readMnemonContext()` injection
in the OpenCode provider handles recall at prompt time. For high-value turns,
still call `mnemon remember` explicitly — the background self-improvement review
that fires in Claude Code doesn't run here.
