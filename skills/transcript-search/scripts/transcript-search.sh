#!/usr/bin/env bash
# transcript-search router — works in container and on host
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/transcript-search.mjs" "$@"
