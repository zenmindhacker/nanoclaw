---
name: wiki
description: Persistent wiki knowledge base. Ingest sources, maintain structured pages, query synthesized knowledge. Use when the user drops URLs, PDFs, or documents to process, asks about past research, or wants to build/maintain a structured knowledge store for this agent.
---

# Wiki — Structured Knowledge Base

The wiki is a persistent, LLM-maintained markdown knowledge base that lives
**agent-wide** at `/workspace/global/wiki/` (host: `groups/global/wiki/`). Unlike
mnemon (episodic facts) or CLAUDE.local.md (procedural instructions), the wiki
accumulates **synthesized multi-source knowledge** — project docs, research,
reference material. Shared across all channels and agent groups for this install.

## Three layers

```
wiki/sources/   raw inputs — immutable; you read but never modify
wiki/           LLM-maintained pages — you own everything here
SKILL.md        schema layer — conventions for this wiki
```

## Three operations

### Ingest

When the user drops a URL, PDF, file path, or text:

1. Save the raw source to `wiki/sources/<name>` (or note the URL)
2. Read it fully — use `curl -sL` for URLs, bash `cat` for files
3. Extract key information, discuss takeaways if appropriate
4. For each relevant wiki page (create or update): summary, entities, concepts,
   cross-references with existing pages
5. Append to `wiki/log.md`: `## [YYYY-MM-DD] ingest | <Source Name>`
6. Update `wiki/index.md` with any new pages

**Process one source at a time.** Never batch-read multiple sources and process
them together — this produces shallow generic pages. Finish one completely before
starting the next.

### Query

When the user asks something answerable from accumulated knowledge:

1. Read `wiki/index.md` first to locate relevant pages
2. Read only the relevant pages (don't scan the whole wiki)
3. Synthesize an answer with citations to wiki pages
4. Good answers can be filed back as new wiki pages if they'd help future queries

### Lint

Periodically health-check the wiki:
- Find contradictions between pages
- Identify orphan pages (no inbound links)
- Flag stale claims superseded by newer sources
- Note missing cross-references

```bash
# Example lint run:
read_file wiki/index.md
# then check flagged pages
```

## File conventions

### `wiki/index.md`
Content catalog — one line per page with a short summary. Update on every ingest.

```markdown
## Index

| Page | Summary | Updated |
|------|---------|---------|
| [cian-projects.md](wiki/cian-projects.md) | Active projects at Cognitivetech | 2026-06-17 |
```

### `wiki/log.md`
Append-only chronological activity log. Each entry starts with:
```
## [YYYY-MM-DD] ingest | Source Title
## [YYYY-MM-DD] query | Query summary
## [YYYY-MM-DD] lint | Notes
```

### Wiki pages
Each page in `wiki/` should have:
- A brief summary at the top
- Cross-references: `See also: [page](wiki/page.md)`
- Source provenance: `Source: wiki/sources/filename.pdf`

## URL ingestion note

`WebFetch` returns summaries, not full documents. For wiki ingestion where full
text matters, download first:

```bash
curl -sLo wiki/sources/article.md "https://example.com/article"
# or for PDFs:
curl -sLo wiki/sources/doc.pdf "https://example.com/doc.pdf"
```

Then use `agent-browser` for JavaScript-heavy pages.

## mnemon vs wiki

| mnemon | wiki |
|--------|------|
| Facts, prefs, entity graph | Multi-source synthesized knowledge |
| Short entries | Full pages with cross-references |
| Always available (injected at prompt) | Read on demand via index |
| Episodic | Reference / research |

A preference like "Cian prefers terse replies" → **mnemon**.
A synthesized doc "Cognitivetech projects overview" → **wiki**.
