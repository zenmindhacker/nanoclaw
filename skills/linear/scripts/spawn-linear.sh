#!/usr/bin/env bash
# spawn-linear.sh — Create Linear issue and auto-cleanup old ones
# Usage: bash spawn-linear.sh "<title>" "<task>"
#
# Uses: /workspace/extra/skills/linear/scripts/linear.ts
# Auto-purges Done/Canceled issues older than 7 days

set -euo pipefail

SCRIPT_DIR="/workspace/extra/skills/linear"
LINEAR=" node $SCRIPT_DIR/scripts/linear.ts --org cog"

# ============== AUTO CLEANUP ==============
echo "=== Auto-cleanup: Checking for old closed issues ==="

# Get all issues - JSON is direct array
ALL_ISSUES=$($LINEAR list --json --limit 100 2>/dev/null) || ALL_ISSUES="[]"

# Filter for OpenClaw issues in Done/Canceled state
DELETED=0
NOW=$(date +%s)

# Process issues
for row in $(echo "$ALL_ISSUES" | jq -r -c '.[] | select(.labels.nodes[].name == "OpenClaw") | select(.state.name == "Done" or .state.name == "Canceled") | {id: .identifier, state: .state.name, created: .createdAt}' 2>/dev/null); do
  id=$(echo "$row" | jq -r '.id')
  state_name=$(echo "$row" | jq -r '.state')
  created_at=$(echo "$row" | jq -r '.created')
  
  # Calculate days old
  created_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${created_at%.*}" +%s 2>/dev/null || echo "$NOW")
  days_old=$(( (NOW - created_ts) / 86400 ))
  
  if [[ $days_old -ge 7 ]]; then
    echo "  Purging: $id ($state_name, ${days_old}d old)"
    $LINEAR update "$id" --status Canceled 2>/dev/null || true
    DELETED=$((DELETED + 1))
  fi
done

if [[ "${DELETED:-0}" -gt 0 ]]; then
  echo "  → Purged $DELETED old issues"
else
  echo "  → No old issues to purge"
fi

echo ""

# ============== CREATE NEW ISSUE ==============
TITLE="$1"
TASK="$2"

# Create issue with OpenClaw label
RESULT=$($LINEAR create "$TITLE" -d "$TASK" -l OpenClaw 2>&1)

ISSUE_ID=$(echo "$RESULT" | grep -oP 'COG-\d+' | head -1)

echo "$RESULT"
echo ""
echo "=== NEXT STEPS ==="
echo "1. Spawn agent: openclaw sessions spawn --agent-id <agent> --task \"$TASK\" --thinking <level>"
echo ""
echo "2. When done: bash close-linear.sh $ISSUE_ID <success|failure> \"<notes>\""