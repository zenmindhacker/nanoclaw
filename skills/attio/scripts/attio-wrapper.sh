#!/usr/bin/env bash
# attio-wrapper.sh — Wrapper for attio CLI that auto-loads API key
#
# Usage: Same as attio CLI
#   attio-wrapper.sh people list --limit 10
#   attio-wrapper.sh companies list --search "Acme"

ATTIO_KEY=$(cat /workspace/extra/credentials/services/attio 2>/dev/null \
         || cat /workspace/extra/credentials/attio 2>/dev/null)

if [[ -z "$ATTIO_KEY" ]]; then
  echo "Error: No Attio API key found in credentials"
  exit 1
fi

# Ensure attio CLI is in PATH (check common install locations)
export PATH="/workspace/extra/skills/invoice-generator/node_modules/.bin:/home/node/.local/node_modules/.bin:/tmp/global-tools/node_modules/.bin:$PATH"

# Pass through all arguments to attio
attio --api-key "$ATTIO_KEY" "$@"
