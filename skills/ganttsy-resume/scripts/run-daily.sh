#!/usr/bin/env bash
set -euo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Paths that differ between host and container.
# Inside container: github is mounted at /workspace/extra/github/
# On host: ~/Documents/GitHub/
GITHUB_ROOT="${GITHUB_ROOT:-/workspace/extra/github}"
TARGET_DIR="${TARGET_DIR:-$GITHUB_ROOT/ganttsy/ganttsy-strategy/team/designer-resumes}"

# Writable state lives in the group workspace, not inside the read-only skills mount.
# On host: ~/nanoclaw/data/sessions/slack_scheduled/workspace/ganttsy-resume/
# Inside container: /workspace/group/ganttsy-resume/
WORK_DIR="${WORK_DIR:-/workspace/group/ganttsy-resume}"
RAW_DIR="$WORK_DIR/candidates/raw"
MD_DIR="$WORK_DIR/candidates/md"
STATE_DIR="$WORK_DIR/.state"

export RAW_DIR MD_DIR STATE_DIR TARGET_DIR GITHUB_ROOT

mkdir -p "$RAW_DIR" "$MD_DIR" "$STATE_DIR"

fetch_out=$("$BASEDIR/scripts/fetch-resumes.sh")
new_resumes=$(echo "$fetch_out" | awk -F= '/NEW_RESUMES/{print $2}')

# Install npm deps on first run (or after package.json changes)
npm install --prefix "$BASEDIR/scripts" --silent 2>/dev/null || true

parse_out=$(node "$BASEDIR/scripts/parse-resumes.cjs")
new_parsed=$(echo "$parse_out" | awk -F= '/NEW_PARSED/{print $2}')

rank_out=$(node "$BASEDIR/scripts/rank-resumes.cjs")

# Sync artifacts into repo using cp (rsync not available in container)
mkdir -p "$TARGET_DIR/candidates/raw" "$TARGET_DIR/candidates/md"
if [[ -d "$RAW_DIR" ]]; then
  cp -n "$RAW_DIR"/. "$TARGET_DIR/candidates/raw/" 2>/dev/null || \
  find "$RAW_DIR" -maxdepth 1 -type f -exec cp -n {} "$TARGET_DIR/candidates/raw/" \;
fi
if [[ -d "$MD_DIR" ]]; then
  find "$MD_DIR" -maxdepth 1 -type f -exec cp -n {} "$TARGET_DIR/candidates/md/" \;
fi

# git commit + push
"$BASEDIR/scripts/sync-drive.sh" || true

# Short summary for sysops
report_file="$STATE_DIR/last_report.json"
if [[ -f "$report_file" ]]; then
  total=$(jq -r '.totalCandidates // 0' "$report_file")
  top3=$(jq -r '.top3[]?.name // ""' "$report_file" 2>/dev/null | grep -v '^$' | head -3)

  echo "=== RESUME EVALUATION SUMMARY ==="
  echo "Total candidates: $total"
  if [[ -n "$top3" ]]; then
    echo "Top candidates:"
    echo "$top3" | nl -v 1
  fi
  echo "Full grid: https://github.com/ganttsy/ganttsy-strategy/blob/main/team/designer-resumes/EVALUATION-GRID.md"
else
  echo "=== RESUME EVALUATION SUMMARY ==="
  echo "No evaluation data found"
fi
