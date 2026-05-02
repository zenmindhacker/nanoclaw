#!/bin/bash
# cleanup-thread-groups.sh — Prune old thread group artifacts.
# Run daily via scheduled task. Safe to run while NanoClaw is active.
#
# What it cleans:
#   - Container logs older than 7 days
#   - IPC temp files (images, PDFs, files) older than 7 days
#   - Empty thread group directories older than 30 days
#
# What it preserves:
#   - Session data (.claude/) — agent memory for thread resumption
#   - CLAUDE.md files — group configs
#   - Non-thread groups (main, global, named groups)

set -euo pipefail

# Resolve paths relative to the NanoClaw project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Use GROUPS_DIR from .env if set, otherwise default
GROUPS_DIR="${GROUPS_DIR:-groups}"
DATA_DIR="${DATA_DIR:-data}"

# Resolve to absolute paths
GROUPS_PATH="$PROJECT_ROOT/$GROUPS_DIR"
DATA_PATH="$PROJECT_ROOT/$DATA_DIR"

LOG_AGE_DAYS=7
IPC_AGE_DAYS=7
EMPTY_DIR_AGE_DAYS=30

echo "[cleanup] Starting thread group cleanup at $(date -Iseconds)"
echo "[cleanup] Groups path: $GROUPS_PATH"
echo "[cleanup] Data path: $DATA_PATH"

# 1. Delete old container logs from thread group directories
LOG_COUNT=0
if [ -d "$GROUPS_PATH" ]; then
  while IFS= read -r -d '' logfile; do
    rm -f "$logfile"
    LOG_COUNT=$((LOG_COUNT + 1))
  done < <(find "$GROUPS_PATH" -path '*/t-*/logs/*.log' -mtime +"$LOG_AGE_DAYS" -print0 2>/dev/null)
fi
echo "[cleanup] Deleted $LOG_COUNT container logs older than $LOG_AGE_DAYS days"

# 2. Delete old IPC temp files (images, PDFs, generic files) for thread groups
IPC_COUNT=0
if [ -d "$DATA_PATH/ipc" ]; then
  while IFS= read -r -d '' ipcfile; do
    rm -f "$ipcfile"
    IPC_COUNT=$((IPC_COUNT + 1))
  done < <(find "$DATA_PATH/ipc" -path '*/t-*/images/*' -o -path '*/t-*/files/*' -mtime +"$IPC_AGE_DAYS" -print0 2>/dev/null)
fi
echo "[cleanup] Deleted $IPC_COUNT IPC files older than $IPC_AGE_DAYS days"

# 3. Remove empty thread group directories (groups and data)
EMPTY_COUNT=0
for base_dir in "$GROUPS_PATH" "$DATA_PATH/ipc" "$DATA_PATH/sessions"; do
  if [ -d "$base_dir" ]; then
    while IFS= read -r -d '' emptydir; do
      # Only delete thread dirs (t-*), never named groups
      dirname="$(basename "$emptydir")"
      if [[ "$dirname" == t-* ]]; then
        rmdir "$emptydir" 2>/dev/null && EMPTY_COUNT=$((EMPTY_COUNT + 1)) || true
      fi
    done < <(find "$base_dir" -maxdepth 1 -type d -name 't-*' -mtime +"$EMPTY_DIR_AGE_DAYS" -empty -print0 2>/dev/null)
  fi
done
echo "[cleanup] Removed $EMPTY_COUNT empty thread group directories older than $EMPTY_DIR_AGE_DAYS days"

echo "[cleanup] Done"
