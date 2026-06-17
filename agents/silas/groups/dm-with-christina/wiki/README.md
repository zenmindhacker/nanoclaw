# Silas Wiki — Life-Admin + Christina Knowledge Base

Accumulated knowledge about Christina's life, health patterns, and operational context.
Built and maintained by Silas using the `wiki` container skill.

## Domain

- **Cycle tracking**: phases, symptoms, patterns, calendar correlation
- **Christina's context**: Meridian Institute, Slack workspace, projects
- **Life admin**: preferences, routines, recurring commitments
- **Health & wellbeing**: astrology/HD context, communication patterns

## Structure

```
wiki/
  index.md              # catalog of all pages
  log.md                # append-only activity log
  sources/              # raw input files (immutable — never edit)
  README.md             # this file
  [pages]/              # wiki pages
```

## Seed source

The existing `cycle_master_reference.md` in this group folder is the primary
seed source. When ready, ingest it to build the first set of wiki pages:

```bash
# Ask Silas to ingest it:
# "Ingest cycle_master_reference.md into the wiki"
```

Do NOT copy the content — the wiki will synthesize from it during ingestion.
The raw file stays at `cycle_master_reference.md`; a wiki page summarizing it
will live at `wiki/cycle-master-reference.md`.

## Conventions

- Cycle dates are sensitive — keep entries factual and non-clinical
- Cross-reference related pages: `See also: [page](wiki/page.md)`
- Source provenance on each page: `Source: cycle_master_reference.md` or URL
- Ingest one source at a time
- Date-stamp log entries: `## [YYYY-MM-DD] ingest | <Title>`
