# workspace-mcp spike (Phase 2b)

**Date:** 2026-06  
**Candidate:** [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) (`workspace-mcp` on PyPI)  
**Decision:** **Defer unified MCP.** Keep **calendar-mcp + gmail-mcp + gws** for Silas production.

## Why defer

| Criterion | Result |
|-----------|--------|
| stdio in OpenCode | Possible with `--single-user` |
| Host OAuth (no container writes) | Achievable via `GOOGLE_MCP_CREDENTIALS_DIR` |
| Tool depth (Docs/Sheets) | Strong |
| NanoClaw install path | **Blocked:** Python/PyPI — not in `container/cli-tools.json` (npm-only seam) |
| Cold start & image size | Adds Python layer + deps; needs dedicated Dockerfile work |
| Multi-account | Supported but adds config complexity |

Production Silas already has working **host OAuth** + **calendar MCP**. Adding Gmail MCP + `gws` covers ~80% of Connected Tutors ops without a Python dependency.

## Acceptance criteria (for future re-eval)

When NanoClaw adds a Python MCP install path or a maintained Node unified server:

- [ ] List/search Drive as hello@connectedtutors.org
- [ ] Read/write Sheet range
- [ ] Read/append Doc
- [ ] Gmail search + send (with Silas confirm policy)
- [ ] Calendar CRUD
- [ ] No container writes to token files
- [ ] Cold start under 5s
- [ ] Stable under OpenCode stdio

## Operator spike (optional, on Silas host)

Run outside the container to evaluate tool shapes before any image change:

```bash
# On christina@cleo-lc — requires Python 3.11+ and uv/pip
export GOOGLE_MCP_CREDENTIALS_DIR="$HOME/.config/nanoclaw/credentials/services"
uv tool install workspace-mcp  # or: pip install workspace-mcp

# Point at shadow-google flat token (copy/symlink into credentials dir layout if needed)
workspace-mcp --single-user --transport stdio
```

Smoke group (when present on server): `ag-1781717553431-d32i6i` — register only after spike passes criteria above:

```bash
SILAS_SMOKE_GROUP=ag-1781717553431-d32i6i scripts/silas/spike-workspace-mcp.sh
```

## Fallback (current production path)

| Service | Tool |
|---------|------|
| Calendar | `@cocal/google-calendar-mcp` → `mcp__calendar__*` |
| Gmail | `@gongrzhe/server-gmail-autoauth-mcp` → `mcp__gmail__*` |
| Drive/Docs/Sheets/Slides | `gws-ct` via bash |
| Cron / batch | `skills/google-workspace/lib/access-token.mjs` |
