#!/usr/bin/env bash
set -euo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${TARGET_DIR:-/Users/cian/Documents/GitHub/ganttsy/ganttsy-strategy/team/designer-resumes}"
RAW_DIR="$BASEDIR/candidates/raw"
MD_DIR="$BASEDIR/candidates/md"
STATE_DIR="$BASEDIR/.state"

mkdir -p "$STATE_DIR"

fetch_out=$("$BASEDIR/scripts/fetch-resumes.sh")
new_resumes=$(echo "$fetch_out" | awk -F= '/NEW_RESUMES/{print $2}')

parse_out=$("$BASEDIR/scripts/parse-resumes.sh")
new_parsed=$(echo "$parse_out" | awk -F= '/NEW_PARSED/{print $2}')

rank_out=$(node "$BASEDIR/scripts/rank-resumes.cjs")

# sync artifacts into repo
mkdir -p "$TARGET_DIR/candidates/raw" "$TARGET_DIR/candidates/md"
if [[ -d "$RAW_DIR" ]]; then
  rsync -a "$RAW_DIR/" "$TARGET_DIR/candidates/raw/"
fi
if [[ -d "$MD_DIR" ]]; then
  rsync -a "$MD_DIR/" "$TARGET_DIR/candidates/md/"
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
