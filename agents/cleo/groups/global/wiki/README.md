# Cleo Wiki

Unified knowledge base for Cleo — shared across all channels and agent groups
(DM, Slack, scheduled tasks, sysops). Not per-container or per-channel.

## Layout

```
wiki/
  index.md      — content catalog (update on every ingest)
  log.md        — append-only activity log
  sources/      — raw inputs (immutable)
  *.md          — synthesized pages
```

## Conventions

See the `wiki` container skill (`/home/node/.claude/skills/wiki/SKILL.md`).

- Process one source at a time
- Cross-reference related pages: `See also: [page](wiki/page.md)`
- Note source provenance on each page: `Source: wiki/sources/...`

Container path: `/workspace/global/wiki/`
