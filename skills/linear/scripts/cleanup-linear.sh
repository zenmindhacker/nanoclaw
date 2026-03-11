#!/usr/bin/env bash
# cleanup-linear.sh — Delete old closed issues in OpenClaw project
# Usage: bash cleanup-linear.sh [--dry-run]
#
# Deletes issues that have been in Done/Canceled state for >7 days
# Use --dry-run to see what would be deleted without actually deleting

set -euo pipefail


PROJECT_ID="55c7660a-5b98-4553-91d3-a0ea78f098c2"
TEAM_ID="bd7e5308-84ee-4aaf-b67a-03c2e7a149d6"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "=== DRY RUN - No changes will be made ==="
fi

graphql() {
  curl -s -X POST https://api.linear.app/graphql \
    -H "Authorization: $LINEAR_API_KEY_COGNITIVE" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"$1\", \"variables\": $2}"
}

# Get states
STATE_DATA=$(graphql 'query { team(id: "bd7e5308-84ee-4aaf-b67a-03c2e7a149d6") { states { nodes { id name } } } }' '{}')
DONE_STATE=$(echo "$STATE_DATA" | jq -r '.data.team.states.nodes[] | select(.name == "Done") | .id')
CANCELLED_STATE=$(echo "$STATE_DATA" | jq -r '.data.team.states.nodes[] | select(.name == "Canceled") | .id')

echo "States - Done: $DONE_STATE, Canceled: $CANCELLED_STATE"
echo ""
echo "=== Finding old closed issues in OpenClaw project ==="

# Query issues - simplified approach
ISSUES=$(graphql '{
  issues(
    filter: {
      project: { id: { eq: "55c7660a-5b98-4553-91d3-a0ea78f098c2" } }
      state: { id: { in: ["'"$DONE_STATE"'", "'"$CANCELLED_STATE"'"] } }
    }
    first: 50
  ) {
    nodes {
      id
      identifier
      title
      createdAt
      completedAt
      state { name }
    }
  }
}' '{}')

# Check if we got any issues
count=$(echo "$ISSUES" | jq '.data.issues.nodes | length')
echo "Found $count closed issues"

if [[ "$count" -eq 0 ]]; then
  echo "No issues to clean up"
  exit 0
fi

echo "$ISSUES" | jq -r '.data.issues.nodes[] | @base64' | while read -r encoded; do
  issue=$(echo "$encoded" | base64 -d | jq '.')
  id=$(echo "$issue" | jq -r '.identifier')
  title=$(echo "$issue" | jq -r '.title')
  created_at=$(echo "$issue" | jq -r '.createdAt')
  completed_at=$(echo "$issue" | jq -r '.completedAt // .createdAt')
  state=$(echo "$issue" | jq -r '.state.name')
  
  # Calculate days since completion
  now=$(date +%s)
  completed_ts=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${completed_at%.*}" +%s 2>/dev/null || echo "$now")
  days_old=$(( (now - completed_ts) / 86400 ))
  
  if [[ $days_old -ge 7 ]]; then
    echo "Old: $id ($state) - $title - ${days_old}d old"
    
    if [[ "$DRY_RUN" == "false" ]]; then
      echo "  Deleting $id..."
      # Delete by identifier
      result=$(graphql 'mutation IssueDelete($id: String!) { issueDelete(id: $id) { success } }' "{\"id\": \"$id\"}")
      if echo "$result" | jq -r '.data.issueDelete.success' 2>/dev/null | grep -q "true"; then
        echo "  → Deleted $id"
      else
        echo "  → Failed to delete $id: $result"
      fi
    fi
  else
    echo "Skipped: $id ($state) - only ${days_old}d old"
  fi
done

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "=== DRY RUN complete - run without --dry-run to delete ==="
else
  echo ""
  echo "=== Cleanup complete ==="
fi