#!/usr/bin/env bash
# close-linear.sh — Close a Linear issue
# Usage: bash close-linear.sh <ISSUE_ID> <success|failure> "<notes>"
#
# Uses: /workspace/extra/skills/linear/scripts/linear.ts

ISSUE_ID="$1"
STATUS="$2"
NOTES="${3:-}"

SCRIPT_DIR="/workspace/extra/skills/linear"
LINEAR="node --experimental-strip-types $SCRIPT_DIR/scripts/linear.ts --org cog"

# Map status to Linear status
case "$STATUS" in
  success) LINEAR_STATUS="Done" ;;
  failure|blocked) LINEAR_STATUS="Blocked" ;;
  *) LINEAR_STATUS="Canceled" ;;
esac

echo "Updating $ISSUE_ID → $LINEAR_STATUS..."
$LINEAR update "$ISSUE_ID" --status "$LINEAR_STATUS"

if [[ -n "$NOTES" ]]; then
  echo "Adding comment..."
  $LINEAR comment "$ISSUE_ID" "$NOTES"
fi

echo "Done: $ISSUE_ID → $LINEAR_STATUS"