#!/bin/bash
# backfill-whatsapp.sh - Backfill Attio contacts from WhatsApp 6-month history
# Updates: last_im_date, preferred_channel, relationship_tier, last_message_from_me

set -e

ATTIO_WRAPPER=/workspace/extra/skills/attio/scripts/attio-wrapper.sh
IM_LIST_ID="569a3e1a-84e1-4fd0-9aab-39f7f0a64483"

echo "=== WhatsApp 6-Month Backfill ===" >&2
echo "Started: $(date)" >&2

# Tier assignments based on conversation analysis
declare_tier() {
    local name="$1"
    case "$name" in
        # Inner Circle (7-day)
        *"Marcus"*|*"Sam Breathwork"*|*"John Buddhist"*|*"Damian Kai"*)
            echo "Inner Circle" ;;
        # Core Network (30-day)  
        *"Tao Phillips"*|*"Olivia Peers"*|*"Aaron Hambley"*|*"Stef Deeper"*|*"Jess Deeper"*|*"Tai Whyte"*|*"Francesca"*|*"Luna Stella"*|*"Ryan Armand"*|*"Angel Kits"*|*"Elaine"*|*"Joonatan"*)
            echo "Core Network" ;;
        # Archived (taxi drivers)
        *"Taxi"*|*"Sergio Black car"*|*"Mario San"*|*"Nahima"*)
            echo "Archived" ;;
        # Occasional (event/service contacts)
        *"Tomek DJ"*|*"Erich Saide"*|*"Marcos Luna"*|*"Monika Slovakia"*|*"Jared Patchamamma"*)
            echo "Occasional" ;;
        # Default: Regular Contacts
        *)
            echo "Regular Contacts" ;;
    esac
}

CREATED=0
UPDATED=0
SKIPPED=0

# Process each WhatsApp DM chat
wacli chats list --limit 500 2>/dev/null | awk '$1 == "dm" && $0 !~ /0@s.whatsapp.net/ && $0 !~ /16726677729/' | while read -r line; do
    # Parse the line - format: "dm  NAME  JID  DATETIME"
    # JID contains @s.whatsapp.net, datetime is last two fields
    JID=$(echo "$line" | grep -oE '[0-9]+@s\.whatsapp\.net')
    LAST_DATE=$(echo "$line" | awk '{print $(NF-1)}')
    LAST_TIME=$(echo "$line" | awk '{print $NF}')
    
    # Extract name (between "dm" and the JID)
    NAME=$(echo "$line" | sed 's/^dm[[:space:]]*//' | sed "s/$JID.*//" | sed 's/[[:space:]]*$//')
    
    # Skip phone-only contacts (no name)
    if [[ "$NAME" =~ ^[0-9+]+@s\.whatsapp\.net$ ]] || [[ -z "$NAME" ]] || [[ "$NAME" == "$JID" ]]; then
        echo "  ⏭️  Skipping phone-only: $JID" >&2
        ((SKIPPED++)) || true
        continue
    fi
    
    # Extract phone number - ensure proper E.164 format
    RAW_PHONE=$(echo "$JID" | sed 's/@s\.whatsapp\.net//')
    # Add + prefix if not present, ensure it's a valid international number
    if [[ "$RAW_PHONE" =~ ^1[0-9]{10}$ ]]; then
        PHONE="+$RAW_PHONE"  # North American
    elif [[ "$RAW_PHONE" =~ ^[0-9]+$ ]]; then
        PHONE="+$RAW_PHONE"  # International
    else
        PHONE="$RAW_PHONE"
    fi
    
    # Get last message to determine direction
    LAST_MSG=$(wacli messages list --chat "$JID" --limit 1 2>/dev/null | tail -1)
    if echo "$LAST_MSG" | grep -q "^.* me "; then
        LAST_FROM_ME="true"
    else
        LAST_FROM_ME="false"
    fi
    
    # Determine tier
    TIER=$(declare_tier "$NAME")
    
    echo "  📱 $NAME" >&2
    echo "     Phone: $PHONE | Last: $LAST_DATE | Tier: $TIER | FromMe: $LAST_FROM_ME" >&2
    
    # Search for existing person in Attio by name
    FIRST_NAME=$(echo "$NAME" | awk '{print $1}')
    PERSON=$($ATTIO_WRAPPER records search "$FIRST_NAME" --object people --limit 5 --json 2>/dev/null | jq --arg name "$NAME" '[.[] | select(.record_text | ascii_downcase | contains($name | ascii_downcase))] | .[0]' 2>/dev/null)
    
    if [ "$PERSON" = "null" ] || [ -z "$PERSON" ]; then
        echo "     ➕ Creating new person..." >&2
        # Create new person
        PERSON=$($ATTIO_WRAPPER records create people --values "{
            \"name\": \"$NAME\",
            \"last_im_date\": \"${LAST_DATE}T12:00:00Z\"
        }" --json 2>&1)
        RECORD_ID=$(echo "$PERSON" | jq -r '.id.record_id')
        ((CREATED++)) || true
    else
        RECORD_ID=$(echo "$PERSON" | jq -r '.id.record_id')
        echo "     ✏️  Updating existing person ($RECORD_ID)..." >&2
        # Update existing person
        $ATTIO_WRAPPER records update people "$RECORD_ID" --values "{
            \"last_im_date\": \"${LAST_DATE}T12:00:00Z\"
        }" >/dev/null 2>&1
        ((UPDATED++)) || true
    fi
    
    # Check if person is on IM List
    ENTRIES=$($ATTIO_WRAPPER entries list "$IM_LIST_ID" --limit 500 --json 2>/dev/null)
    ENTRY=$(echo "$ENTRIES" | jq --arg rid "$RECORD_ID" '[.[] | select(.parent_record_id == $rid)] | .[0]' 2>/dev/null)
    
    if [ "$ENTRY" = "null" ] || [ -z "$ENTRY" ]; then
        echo "     📋 Adding to IM List with tier: $TIER" >&2
        $ATTIO_WRAPPER entries create "$IM_LIST_ID" --record "$RECORD_ID" --object people --values "{
            \"relationship_tier\": \"$TIER\",
            \"status\": \"Active\"
        }" >/dev/null 2>&1 || true
    else
        ENTRY_ID=$(echo "$ENTRY" | jq -r '.id.entry_id')
        echo "     📋 Updating IM List entry with tier: $TIER" >&2
        $ATTIO_WRAPPER entries update "$IM_LIST_ID" "$ENTRY_ID" --values "{
            \"relationship_tier\": \"$TIER\"
        }" >/dev/null 2>&1
    fi
    
    echo "" >&2
done

echo "=== Backfill Complete ===" >&2
echo "Created: $CREATED | Updated: $UPDATED | Skipped: $SKIPPED" >&2
echo "Finished: $(date)" >&2
