#!/bin/bash
# sync-messages.sh - Pull last 24h messages from all platforms, output JSON for agent processing
# Usage: sync-messages.sh [--since HOURS]
# Output: JSON with new_contacts, field_updates, errors

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="$SCRIPT_DIR/../config"
BEEPER_TOKEN=$(cat /workspace/extra/credentials/beeper)
ATTIO_WRAPPER=/workspace/extra/skills/attio/scripts/attio-wrapper.sh

# Default: last 24 hours
HOURS=${1:-24}
SINCE=$(date -v-${HOURS}H -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "$HOURS hours ago" -u +%Y-%m-%dT%H:%M:%SZ)

# Output arrays
NEW_CONTACTS=()
FIELD_UPDATES=()
ERRORS=()

echo "=== IM Sync: Last ${HOURS}h ===" >&2
echo "Since: $SINCE" >&2

# Get my identities
MY_SIGNAL_ID="@zenmindhacker:beeper.com"
MY_INSTAGRAM_ID="@zenmindhacker:beeper.com"

# Function to sync Beeper chats
sync_beeper() {
    local NETWORK=$1
    echo "Syncing $NETWORK via Beeper..." >&2
    
    # Get all chats for this network
    CHATS=$(curl -s -H "Authorization: Bearer $BEEPER_TOKEN" \
        "http://localhost:23373/v1/chats?limit=100" | \
        jq -c "[.items[] | select(.network == \"$NETWORK\")]")
    
    CHAT_COUNT=$(echo "$CHATS" | jq 'length')
    echo "  Found $CHAT_COUNT $NETWORK chats" >&2
    
    # Process each chat
    echo "$CHATS" | jq -c '.[]' | while read -r chat; do
        CHAT_ID=$(echo "$chat" | jq -r '.id')
        CHAT_NAME=$(echo "$chat" | jq -r '.title // "Unknown"')
        LAST_ACTIVITY=$(echo "$chat" | jq -r '.lastActivity // ""')
        
        # Skip if no recent activity
        if [ -n "$LAST_ACTIVITY" ] && [[ "$LAST_ACTIVITY" < "$SINCE" ]]; then
            continue
        fi
        
        # Get preview message info
        PREVIEW_SENDER=$(echo "$chat" | jq -r '.preview.senderID // ""')
        PREVIEW_TEXT=$(echo "$chat" | jq -r '.preview.text // ""')
        PREVIEW_TIME=$(echo "$chat" | jq -r '.preview.timestamp // ""')
        IS_FROM_ME=$(echo "$chat" | jq -r '.preview.isSender // false')
        
        # Get other participant info
        CONTACT_NAME=$(echo "$chat" | jq -r '.participants.items[] | select(.isSelf == false) | .fullName' | head -1)
        CONTACT_USERNAME=$(echo "$chat" | jq -r '.participants.items[] | select(.isSelf == false) | .username' | head -1)
        
        if [ -n "$CONTACT_NAME" ] && [ "$CONTACT_NAME" != "null" ]; then
            # Output as JSON for agent to process
            echo "{\"type\":\"message\",\"network\":\"$NETWORK\",\"chat_id\":\"$CHAT_ID\",\"contact_name\":\"$CONTACT_NAME\",\"contact_username\":\"$CONTACT_USERNAME\",\"last_activity\":\"$LAST_ACTIVITY\",\"last_message\":$(echo "$PREVIEW_TEXT" | jq -Rs '.[:200]'),\"is_from_me\":$IS_FROM_ME}"
        fi
    done
}

# Function to sync WhatsApp via wacli
sync_whatsapp() {
    echo "Syncing WhatsApp via wacli..." >&2
    
    # Check if wacli is available
    if ! command -v wacli &> /dev/null; then
        echo "{\"type\":\"error\",\"source\":\"whatsapp\",\"message\":\"wacli not found\"}"
        return
    fi
    
    # Get recent messages
    MESSAGES=$(wacli messages list --limit 50 --json 2>/dev/null || echo "[]")
    
    if [ "$MESSAGES" = "[]" ]; then
        echo "  No WhatsApp messages found" >&2
        return
    fi
    
    # Process messages and group by contact
    echo "$MESSAGES" | jq -c '.[] | select(.timestamp > "'$SINCE'")' 2>/dev/null | while read -r msg; do
        CONTACT_JID=$(echo "$msg" | jq -r '.remoteJid // ""')
        CONTACT_NAME=$(echo "$msg" | jq -r '.pushName // .remoteJid')
        MSG_TEXT=$(echo "$msg" | jq -r '.message.conversation // .message.extendedTextMessage.text // ""')
        MSG_TIME=$(echo "$msg" | jq -r '.timestamp')
        IS_FROM_ME=$(echo "$msg" | jq -r '.fromMe // false')
        
        if [ -n "$CONTACT_NAME" ] && [ "$CONTACT_NAME" != "null" ]; then
            # Extract phone from JID
            PHONE=$(echo "$CONTACT_JID" | sed 's/@s.whatsapp.net//' | sed 's/^/+/')
            
            echo "{\"type\":\"message\",\"network\":\"WhatsApp\",\"contact_name\":\"$CONTACT_NAME\",\"phone\":\"$PHONE\",\"last_activity\":\"$MSG_TIME\",\"last_message\":$(echo "$MSG_TEXT" | jq -Rs '.[:200]'),\"is_from_me\":$IS_FROM_ME}"
        fi
    done
}

# Run syncs and collect output
echo "{"
echo "  \"sync_time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
echo "  \"since\": \"$SINCE\","
echo "  \"messages\": ["

# Collect all messages
FIRST=true
{
    sync_beeper "Signal"
    sync_beeper "Instagram"
    sync_beeper "Facebook/Messenger"
    sync_beeper "LinkedIn"
    sync_whatsapp
} | while read -r line; do
    if [ "$FIRST" = true ]; then
        FIRST=false
    else
        echo ","
    fi
    echo "    $line"
done

echo "  ]"
echo "}"
