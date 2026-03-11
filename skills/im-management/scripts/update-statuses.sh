#!/bin/bash
# update-statuses.sh - Calculate and update contact recency status based on tier cadence
# Run by OpenClaw agent during daily sync
# Output: JSON summary of status changes

set -e

ATTIO_WRAPPER=/workspace/extra/skills/attio/scripts/attio-wrapper.sh
IM_LIST_ID="569a3e1a-84e1-4fd0-9aab-39f7f0a64483"

# Function to get cadence for tier
get_cadence() {
    case "$1" in
        "Inner Circle") echo 7 ;;
        "Core Network") echo 30 ;;
        "Regular Contacts") echo 60 ;;
        "Occasional") echo 120 ;;
        *) echo 60 ;;
    esac
}

NOW=$(date -u +%s)

echo "=== Updating Contact Statuses ===" >&2

# Track changes
UPDATED=0
SKIPPED=0

# Get all IM List entries
ENTRIES=$($ATTIO_WRAPPER entries list "$IM_LIST_ID" --limit 500 --json 2>/dev/null)

echo "$ENTRIES" | jq -c '.[]' | while read -r entry; do
    ENTRY_ID=$(echo "$entry" | jq -r '.id.entry_id')
    RECORD_ID=$(echo "$entry" | jq -r '.parent_record_id // .id.record_id')
    CURRENT_STATUS=$(echo "$entry" | jq -r '.entry_values.status[0].status.title // "Unknown"')
    TIER=$(echo "$entry" | jq -r '.entry_values.relationship_tier[0].option.title // "Regular Contacts"')
    
    # Skip manually paused
    if [ "$CURRENT_STATUS" = "On Pause" ]; then
        echo "  ⏸️  Skipping (On Pause)" >&2
        ((SKIPPED++)) || true
        continue
    fi
    
    # Get person details
    PERSON=$($ATTIO_WRAPPER records get people "$RECORD_ID" --json 2>/dev/null)
    NAME=$(echo "$PERSON" | jq -r '.values.name[0].full_name // "Unknown"')
    LAST_IM_DATE=$(echo "$PERSON" | jq -r '.values.last_im_date[0].value // ""')
    LAST_FROM_ME=$(echo "$PERSON" | jq -r '.values.last_message_from_me[0].value // "true"')
    
    # Calculate days since last contact
    if [ -n "$LAST_IM_DATE" ] && [ "$LAST_IM_DATE" != "null" ]; then
        LAST_IM_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_IM_DATE%%.*}" +%s 2>/dev/null || date -d "$LAST_IM_DATE" +%s 2>/dev/null || echo "0")
        DAYS_SINCE=$(( (NOW - LAST_IM_EPOCH) / 86400 ))
    else
        DAYS_SINCE=999
    fi
    
    # Get expected cadence for this tier
    EXPECTED=$(get_cadence "$TIER")
    
    # Calculate new status based on thresholds from design doc:
    # Active: within expected cadence
    # Check Soon: 75-100% of expected
    # Overdue: 100-150% of expected
    # Reconnect: 150%+ of expected
    
    THRESHOLD_CHECK_SOON=$((EXPECTED * 3 / 4))  # 75%
    THRESHOLD_OVERDUE=$EXPECTED                  # 100%
    THRESHOLD_RECONNECT=$((EXPECTED * 3 / 2))    # 150%
    
    if [ "$LAST_FROM_ME" = "false" ]; then
        # They messaged, waiting on me - always high priority
        NEW_STATUS="Overdue"
    elif [ $DAYS_SINCE -ge $THRESHOLD_RECONNECT ]; then
        NEW_STATUS="Reconnect"
    elif [ $DAYS_SINCE -ge $THRESHOLD_OVERDUE ]; then
        NEW_STATUS="Overdue"
    elif [ $DAYS_SINCE -ge $THRESHOLD_CHECK_SOON ]; then
        NEW_STATUS="Check Soon"
    else
        NEW_STATUS="Active"
    fi
    
    # Update if changed
    if [ "$NEW_STATUS" != "$CURRENT_STATUS" ]; then
        echo "  📊 $NAME: $CURRENT_STATUS → $NEW_STATUS (${DAYS_SINCE}d / ${EXPECTED}d)" >&2
        $ATTIO_WRAPPER entries update "$IM_LIST_ID" "$ENTRY_ID" --values "{\"status\": \"$NEW_STATUS\"}" >/dev/null 2>&1
        ((UPDATED++)) || true
        echo "{\"name\": \"$NAME\", \"old_status\": \"$CURRENT_STATUS\", \"new_status\": \"$NEW_STATUS\", \"days_since\": $DAYS_SINCE, \"tier\": \"$TIER\"}"
    fi
done

echo "" >&2
echo "=== Status Update Complete ===" >&2
echo "Updated: $UPDATED | Skipped: $SKIPPED" >&2
