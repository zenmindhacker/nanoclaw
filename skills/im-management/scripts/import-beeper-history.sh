#!/bin/bash
# Import Beeper chat history (Signal/Instagram) to Attio
# Usage: import-beeper-history.sh [signal|instagram|all]

set -e

BEEPER_TOKEN=$(cat /workspace/extra/credentials/beeper)
PLATFORM=${1:-all}
IM_LIST_ID="569a3e1a-84e1-4fd0-9aab-39f7f0a64483"

# Calculate 6 months ago
SIX_MONTHS_AGO=$(date -v-6m -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "6 months ago" -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== Beeper History Import ==="
echo "Platform: $PLATFORM"
echo "Since: $SIX_MONTHS_AGO"
echo ""

# Get chats filtered by platform
if [ "$PLATFORM" = "all" ]; then
    FILTER='select(.network == "Signal" or .network == "Instagram")'
else
    FILTER="select(.network == \"$PLATFORM\")"
fi

# Fetch and process each chat
curl -s -H "Authorization: Bearer $BEEPER_TOKEN" \
    "http://localhost:23373/v1/chats?limit=100" | \
    jq -c ".items[] | $FILTER | {
        id,
        network,
        title,
        lastActivity,
        contact: (.participants.items[] | select(.isSelf == false) | {name: .fullName, username: .username})
    }"
