#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-}"
shift || true
case "$CMD" in
  browse|refresh-login|bb-health)
    exec node "$DIR/stagehand.mjs" "${CMD/bb-/}" "$@"
    ;;
  *)
    exec node "$DIR/torrentday.mjs" "$CMD" "$@"
    ;;
esac
