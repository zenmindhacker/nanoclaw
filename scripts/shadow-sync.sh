#!/usr/bin/env bash
# Push Shadow recorder SQLite (main + WAL sidecars) from macOS to Cleo.
# Manual run: scripts/shadow-sync.sh
# LaunchAgent (every 15 min): ~/Library/LaunchAgents/com.nanoclaw.shadow-sync.plist
#   — invokes rsync directly (launchd cannot execute scripts from Documents).
set -euo pipefail

SHADOW_DIR="${SHADOW_DIR:-$HOME/Library/Application Support/com.taperlabs.shadow}"
REMOTE="${SHADOW_REMOTE:-cian@cleo-lc.cognitivetech.net:/home/cian/shadow-data/}"

if [[ ! -f "${SHADOW_DIR}/shadow.db" ]]; then
  echo "shadow-sync: missing ${SHADOW_DIR}/shadow.db" >&2
  exit 1
fi

echo "shadow-sync: $(date -Iseconds) → ${REMOTE}"
exec rsync -az --timeout=60 \
  --include='shadow.db' \
  --include='shadow.db-wal' \
  --include='shadow.db-shm' \
  --exclude='*' \
  "${SHADOW_DIR}/" \
  "${REMOTE}"
