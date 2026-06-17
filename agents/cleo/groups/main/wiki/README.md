# Cleo Wiki — Operational Knowledge Base

Accumulated knowledge about Cian's work, companies, integrations, and workflows.
Built and maintained by Cleo using the `wiki` container skill.

## Domain

- **Cian's companies and clients**: Cognitivetech, CopperTeams, Athena AI, Ganttsy, NVS
- **Integrations and tools**: Linear, Xero, Toggl, Ganttsy ATS, Substack
- **NanoClaw infrastructure**: OAuth tokens, scheduled tasks, deployment patterns
- **Recurring workflows**: NVS invoice generation, transcript sync, client context

## Structure

```
wiki/
  index.md              # catalog of all pages
  log.md                # append-only activity log
  sources/              # raw input files (immutable — never edit these)
  README.md             # this file
  [pages]/              # wiki pages (created during ingestion)
```

## Seed sources to ingest

When time allows, ingest these to prime the wiki:

1. Cian's Substack articles from mindhacker.com (competitive landscape, voice, positioning)
2. NVS SOW or project brief (invoice context, scope, billing)
3. CopperTeams / Ganttsy product context (existing context from sessions)

## Conventions

- Cross-reference related pages: `See also: [page](wiki/page.md)`
- Note source provenance on each page: `Source: wiki/sources/...`
- Date-stamp entries in `log.md`: `## [YYYY-MM-DD] ingest | <Title>`
- Ingest one source at a time — finish one completely before starting the next

## mnemon vs wiki

Short preference/fact → **mnemon remember**  
Multi-source synthesized reference → **wiki ingest**
