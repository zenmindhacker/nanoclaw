# Silas Wiki

Unified knowledge base for Silas — shared across all channels and agent groups.
Not per-container or per-channel.

## Layout

```
wiki/
  index.md      — content catalog (update on every ingest)
  log.md        — append-only activity log
  sources/      — raw inputs (immutable)
  *.md          — synthesized pages
```

Seed ingest target: `cycle_master_reference.md` from the Christina DM group folder
→ synthesize to `wiki/cycle-master-reference.md`.

Container path: `/workspace/global/wiki/`
