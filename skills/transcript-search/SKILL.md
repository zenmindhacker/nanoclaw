---
name: transcript-search
description: Search meeting transcripts directly from the local SQLite database (Shadow.do recorder). Use when asked to find meetings, transcripts, recordings, or conversations by org (Ganttsy, CopperTeams, CognitiveTech), attendee (Christina, Kevin), topic (onboarding, planning, strategy), date, or full-text grep. Read-only — no file copying or git sync.
---

# Transcript Search

Query the meeting transcript SQLite database directly. No copying transcripts to repos, no cron sync — just search, list, and read.

**Companion skill:** `transcript-sync` exports transcripts to GitHub repos on a cron. Use **transcript-search** when you need live DB queries, grep, or excerpts without waiting for sync.

**Script:** `{baseDir}/scripts/transcript-search.mjs` (Node `node:sqlite`, no npm install)  
**Router:** `{baseDir}/scripts/transcript-search.sh`

## When to Use

- "Find Ganttsy planning meetings from last month"
- "Which transcripts mention project onboarding?"
- "Show me Christina coaching sessions"
- "CopperTeams meetings about quora"
- "What did we discuss in conv 460?"
- Any meeting search where exported markdown in git repos is incomplete or stale

**Not for:** syncing transcripts to GitHub (use `transcript-sync`).

## Database

| Environment | Path |
|-------------|------|
| **NanoClaw container** | `/workspace/extra/shadow/shadow.db` (auto-detected) |
| **macOS host** | `~/Library/Application Support/com.taperlabs.shadow/shadow.db` |
| **Override** | `SHADOW_DB_PATH` env var |

Open **read-only** via `node:sqlite` — no copy to `/tmp`.

**Completed transcripts:** `transStatus = 3` (always filtered).

**Timestamps:** ISO without timezone — local time (Costa Rica, UTC-6).

## Quick Start

### In container (Cleo)

```bash
TS="{baseDir}/scripts/transcript-search.sh"

$TS presets
$TS preset ganttsy --since-days 30
$TS search --preset ganttsy --grep "project onboarding"
$TS excerpts --preset ganttsy --grep "project onboarding"
$TS show 460
$TS extract --preset ganttsy --grep "project onboarding" --output /workspace/group/transcript-search/onboarding.md
```

### On macOS host

```bash
TS="node ~/.claude/skills/transcript-search/scripts/transcript-search.mjs"
# same commands — DB path auto-detects to ~/Library/Application Support/...
```

## Agent Workflow

```
search/preset  →  excerpts (scan)  →  show/extract (deep dive)  →  summarize
```

### 1. Find meetings (metadata only)

`preset`, `search` → `convIdx`, title, date. **No transcript text.**

### 2. Get transcript text

| Goal | Command |
|------|---------|
| Print one meeting | `show <convIdx>` |
| Save one meeting | `show <convIdx> --output /workspace/group/transcript-search/<file>.md` |
| Save all hits | `extract --preset ganttsy --grep "topic" --output /workspace/group/transcript-search/batch.md` |
| Triage without full text | `excerpts --preset ganttsy --grep "project onboarding"` |
| Structured output | `show <convIdx> --json` |

**Token discipline:** Start with `excerpts` for multi-meeting topics. Use `extract --output` for summarization (keeps chat context small). A full planning meeting is ~15–30k chars.

### 3. Output locations

| Environment | Recommended output dir |
|-------------|------------------------|
| Container | `/workspace/group/transcript-search/` (writable) |
| macOS | `/tmp/` or workspace path |

## Commands

| Command | Transcript text? | Writes file? |
|---------|------------------|--------------|
| `preset` / `search` | No | No |
| `show <id>` | Yes | With `--output FILE` |
| `extract [filters] --output FILE` | Yes (combined markdown) | Yes |
| `excerpts [filters] --grep TERM` | Snippets only | No |

## Named Presets

| Preset | Signals |
|--------|---------|
| `ganttsy` | Title/cal "Ganttsy", `@ganttsy.com` in attendees or cal metadata |
| `ganttsy-planning` | "Ganttsy Planning" recurring series |
| `ganttsy-strategy` | "Ganttsy Strategy" recurring series |
| `ganttsy-onboarding` | `ganttsy` + transcript contains "onboarding" |
| `copperteams` | CopperTeams title patterns, `@copperteams.ai` |
| `cognitivetech` | `CTC:` titles or cal client attendees (excl. ganttsy/copper) |
| `coaching` | Title contains "Coaching" |
| `christina` | Christina email / name |
| `kevin` | Kevin email / name |
| `mondo-zen` | Mondo Zen domains / title keywords |

Presets are **inclusive** — combine with `--grep`, `--title`, `--any` to narrow.

## Search Flags

`--since-days N` · `--from` / `--to` · `--title` · `--grep` · `--grep-speaker` · `--attendee-email` · `--attendee-domain` · `--attendee-name` · `--calendar-id` · `--any` · `--preset` · `--limit N` · `--output FILE` · `--json`

## Schema Notes

Search across **four signal layers**:

1. `SHADOW_CONVERSATION.convTitle`
2. `SHADOW_ATTENDEE` (often sparse — only `cian@cognitivetech.net`)
3. `SHADOW_CAL_EVENT` — `eventTitle`, `eventDescription` (HTML with emails), `eventAttendees` (JSON)
4. `SHADOW_TRANSCRIPT.transContent` — `--grep`

**Key insight:** Ganttsy/CopperTeams attendee lists are often in cal `eventDescription` / `eventAttendees`, not `SHADOW_ATTENDEE`.

### Known calendar IDs

| ID | Label |
|----|-------|
| `c_ed7a5f763561bf4de136dac98759d2e01875cb730c61b5f4a3308654d5c54941@group.calendar.google.com` | CT shared — Ganttsy Planning/Strategy/Feature Review, CopperTeams |
| `cian@cognitivetech.net` | CognitiveTech |
| `cian@copperteams.ai` | CopperTeams |
| `cian@ganttsy.com` | Ganttsy |

## Examples

```bash
TS="{baseDir}/scripts/transcript-search.sh"

# Ganttsy + project onboarding
$TS search --preset ganttsy --grep "project onboarding"
$TS excerpts --preset ganttsy --grep "project onboarding"
$TS extract --preset ganttsy --grep "project onboarding" --output /workspace/group/transcript-search/onboarding.md

# Recurring series
$TS preset ganttsy-planning
$TS preset ganttsy-strategy

# CopperTeams topic
$TS preset copperteams --grep "quora"

# Debug SQL
$TS sql --preset ganttsy --grep "onboarding"
```

## Limitations

- **No live Google Calendar** — cached `SHADOW_CAL_EVENT` only (~40% of convs lack `eventId`)
- **Ganttsy Workspace Drive docs** not in this DB
- **Grep is SQL LIKE** — case-sensitive; use consistent casing or `excerpts` to verify

## Local Install (macOS)

Canonical source: `nanoclaw/skills/transcript-search/` (this repo).  
Host copy for Claude Code / Cursor global skills: `~/.claude/skills/transcript-search/` — sync from repo when updated.
