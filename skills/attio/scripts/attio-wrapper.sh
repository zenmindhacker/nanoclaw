#!/usr/bin/env bash
# attio-wrapper.sh — Wrapper for attio CLI that auto-loads API key
#
# Usage: Same as attio CLI
#   attio-wrapper.sh people list --limit 10
#   attio-wrapper.sh companies list --search "Acme"

ATTIO_KEY=$(cat /workspace/extra/credentials/attio 2>/dev/null)

if [[ -z "$ATTIO_KEY" ]]; then
  echo "Error: No Attio API key found in /workspace/extra/credentials/attio"
  exit 1
fi

# Pass through all arguments to attio
attio --api-key "$ATTIO_KEY" "$@"
