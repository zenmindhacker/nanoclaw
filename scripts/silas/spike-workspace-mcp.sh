#!/usr/bin/env bash
# Optional Phase 2b spike: register workspace-mcp on Silas smoke group (host Python install required).
# See skills/google-workspace/docs/WORKSPACE-MCP-SPIKE.md — default decision is NOT to run this in prod.
set -euo pipefail

GROUP_ID="${SILAS_SMOKE_GROUP:-ag-1781717553431-d32i6i}"
CRED_DIR="${GOOGLE_MCP_CREDENTIALS_DIR:-$HOME/.config/nanoclaw/credentials/services}"

if ! command -v workspace-mcp >/dev/null 2>&1; then
  echo "workspace-mcp not installed. Install with: uv tool install workspace-mcp" >&2
  exit 1
fi

if [[ ! -f "$CRED_DIR/shadow-google-token.json" ]]; then
  echo "Missing shadow-google token at $CRED_DIR/shadow-google-token.json" >&2
  exit 1
fi

echo "Registering workspace-mcp on smoke group $GROUP_ID (stdio, single-user)…"

pnpm run ncl groups config add-mcp-server \
  --id "$GROUP_ID" \
  --name workspace \
  --command workspace-mcp \
  --args '["--single-user","--transport","stdio"]' \
  --env "{\"GOOGLE_MCP_CREDENTIALS_DIR\":\"/workspace/extra/credentials\"}"

echo "Restart smoke group container and verify mcp__workspace__* tools."
