#!/bin/bash
# collect-digest-data.sh - Collect data for daily digest
# Output: JSON with contacts due for outreach, pending reviews, etc.

set -e

ATTIO_WRAPPER=/workspace/extra/skills/attio/scripts/attio-wrapper.sh
IM_LIST_ID="569a3e1a-84e1-4fd0-9aab-39f7f0a64483"
CONFIG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../config"

# Load tier cadences
INNER_CIRCLE_DAYS=7
CORE_NETWORK_DAYS=30
REGULAR_CONTACTS_DAYS=60
OCCASIONAL_DAYS=120

NOW=$(date -u +%s)

echo "=== Collecting Digest Data ===" >&2

# Get all IM List entries with their details
ENTRIES=$($ATTIO_WRAPPER entries list "$IM_LIST_ID" --limit 500 --json 2>/dev/null)

echo "{"
echo "  \"generated_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
echo "  \"contacts\": ["

FIRST=true
echo "$ENTRIES" | jq -c '.[]' | while read -r entry; do
    RECORD_ID=$(echo "$entry" | jq -r '.parent_record_id // empty')
    ENTRY_ID=$(echo "$entry" | jq -r '.id.entry_id')
    STATUS=$(echo "$entry" | jq -r '.entry_values.status[0].status.title // "Unknown"')
    PRIORITY=$(echo "$entry" | jq -r '.entry_values.relationship_tier[0].status.title // "Regular Contacts"')
    
    # Skip paused contacts
    if [ "$STATUS" = "On Pause" ]; then
        continue
    fi
    
    # Get person details
    PERSON=$($ATTIO_WRAPPER records get people "$RECORD_ID" --json 2>/dev/null)
    NAME=$(echo "$PERSON" | jq -r '.values.name[0].full_name // "Unknown"')
    LAST_IM_DATE=$(echo "$PERSON" | jq -r '.values.last_im_date[0].value // ""')
    LAST_MESSAGE=$(echo "$PERSON" | jq -r '.values.last_whatsapp_message[0].value // ""')
    LAST_FROM_ME=$(echo "$PERSON" | jq -r '.values.last_message_from_me[0].value // true')
    PREFERRED_CHANNEL=$(echo "$PERSON" | jq -r '.values.preferred_channel[0].option.title // "WhatsApp"')
    
    # Calculate days since last contact
    if [ -n "$LAST_IM_DATE" ] && [ "$LAST_IM_DATE" != "null" ]; then
        LAST_IM_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_IM_DATE%%.*}" +%s 2>/dev/null || date -d "$LAST_IM_DATE" +%s 2>/dev/null || echo "0")
        DAYS_SINCE=$(( (NOW - LAST_IM_EPOCH) / 86400 ))
    else
        DAYS_SINCE=999
    fi
    
    # Determine expected cadence based on priority/tier
    case "$PRIORITY" in
        "Inner Circle") EXPECTED=$INNER_CIRCLE_DAYS ;;
        "Core Network") EXPECTED=$CORE_NETWORK_DAYS ;;
        "Regular Contacts") EXPECTED=$REGULAR_CONTACTS_DAYS ;;
        "Occasional") EXPECTED=$OCCASIONAL_DAYS ;;
        *) EXPECTED=$REGULAR_CONTACTS_DAYS ;;
    esac
    
    # Calculate urgency
    if [ "$LAST_FROM_ME" = "false" ]; then
        URGENCY="waiting_on_me"
    elif [ $DAYS_SINCE -gt $((EXPECTED * 3 / 2)) ]; then
        URGENCY="reconnect"
    elif [ $DAYS_SINCE -gt $EXPECTED ]; then
        URGENCY="overdue"
    elif [ $DAYS_SINCE -gt $((EXPECTED * 3 / 4)) ]; then
        URGENCY="check_soon"
    else
        URGENCY="active"
    fi
    
    # Only include contacts that need attention
    if [ "$URGENCY" = "active" ]; then
        continue
    fi
    
    # Output contact info
    if [ "$FIRST" = true ]; then
        FIRST=false
    else
        echo ","
    fi
    
    cat <<EOF
    {
      "record_id": "$RECORD_ID",
      "entry_id": "$ENTRY_ID",
      "name": "$NAME",
      "tier": "$PRIORITY",
      "status": "$STATUS",
      "days_since_contact": $DAYS_SINCE,
      "expected_cadence": $EXPECTED,
      "urgency": "$URGENCY",
      "waiting_on_me": $([ "$LAST_FROM_ME" = "false" ] && echo "true" || echo "false"),
      "last_message": $(echo "$LAST_MESSAGE" | jq -Rs '.[:100]'),
      "preferred_channel": "$PREFERRED_CHANNEL"
    }
EOF
done

echo "  ]"
echo "}"
