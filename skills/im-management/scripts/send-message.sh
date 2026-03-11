#!/bin/bash
# send-message.sh - Send message via appropriate channel and update Attio
# Usage: send-message.sh <channel> <attio-person-id> <message>
# Channels: whatsapp, signal, instagram, facebook, linkedin, imessage

set -e

CHANNEL=$1
PERSON_ID=$2
MESSAGE=$3

if [ -z "$CHANNEL" ] || [ -z "$PERSON_ID" ] || [ -z "$MESSAGE" ]; then
    echo "Usage: send-message.sh <channel> <attio-person-id> <message>" >&2
    exit 1
fi

BEEPER_TOKEN=$(cat /workspace/extra/credentials/beeper)
ATTIO_WRAPPER=/workspace/extra/skills/attio/scripts/attio-wrapper.sh

echo "=== Sending Message ===" >&2
echo "Channel: $CHANNEL" >&2
echo "Person ID: $PERSON_ID" >&2

# Get contact info from Attio
CONTACT=$($ATTIO_WRAPPER records get people "$PERSON_ID" --json 2>/dev/null)
NAME=$(echo "$CONTACT" | jq -r '.values.name[0].full_name // "Unknown"')
PHONE=$(echo "$CONTACT" | jq -r '.values.phone_numbers[0].phone_number // ""')

echo "Contact: $NAME" >&2

case $CHANNEL in
    whatsapp)
        if [ -z "$PHONE" ]; then
            echo '{"success": false, "error": "No phone number for WhatsApp"}' 
            exit 1
        fi
        echo "Sending via wacli to $PHONE..." >&2
        wacli send "$PHONE" "$MESSAGE"
        ;;
        
    signal|instagram|facebook|linkedin)
        # Get Beeper chat ID - would need to be stored in Attio or looked up
        CHAT_ID_FIELD="${CHANNEL}_chat_id"
        BEEPER_CHAT_ID=$(echo "$CONTACT" | jq -r ".values.${CHAT_ID_FIELD}[0].value // \"\"")
        
        if [ -z "$BEEPER_CHAT_ID" ] || [ "$BEEPER_CHAT_ID" = "null" ]; then
            # Try to find chat by searching Beeper
            echo "Looking up Beeper chat for $NAME on $CHANNEL..." >&2
            
            NETWORK_NAME="$CHANNEL"
            [ "$CHANNEL" = "facebook" ] && NETWORK_NAME="Facebook/Messenger"
            [ "$CHANNEL" = "linkedin" ] && NETWORK_NAME="LinkedIn"
            [ "$CHANNEL" = "signal" ] && NETWORK_NAME="Signal"
            [ "$CHANNEL" = "instagram" ] && NETWORK_NAME="Instagram"
            
            BEEPER_CHAT_ID=$(curl -s -H "Authorization: Bearer $BEEPER_TOKEN" \
                "http://localhost:23373/v1/chats?limit=100" | \
                jq -r ".items[] | select(.network == \"$NETWORK_NAME\" and .title == \"$NAME\") | .id" | head -1)
        fi
        
        if [ -z "$BEEPER_CHAT_ID" ]; then
            echo '{"success": false, "error": "Could not find Beeper chat for this contact"}' 
            exit 1
        fi
        
        echo "Sending via Beeper to chat $BEEPER_CHAT_ID..." >&2
        
        RESULT=$(curl -s -X POST -H "Authorization: Bearer $BEEPER_TOKEN" \
            -H "Content-Type: application/json" \
            "http://localhost:23373/v1/chats/$(echo -n "$BEEPER_CHAT_ID" | jq -sRr @uri)/messages" \
            -d "{\"text\": $(echo "$MESSAGE" | jq -Rs .)}")
        
        if echo "$RESULT" | jq -e '.id' > /dev/null 2>&1; then
            echo "Message sent successfully" >&2
        else
            echo "{\"success\": false, \"error\": \"Beeper send failed\", \"details\": $RESULT}"
            exit 1
        fi
        ;;
        
    imessage|sms)
        if [ -z "$PHONE" ]; then
            echo '{"success": false, "error": "No phone number for iMessage"}' 
            exit 1
        fi
        echo "Sending via iMessage to $PHONE..." >&2
        osascript -e "tell application \"Messages\" to send \"$MESSAGE\" to buddy \"$PHONE\""
        ;;
        
    *)
        echo "{\"success\": false, \"error\": \"Unknown channel: $CHANNEL\"}"
        exit 1
        ;;
esac

# Update Attio on success
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "Updating Attio..." >&2

$ATTIO_WRAPPER records update people "$PERSON_ID" --values "{
    \"last_im_date\": \"$NOW\",
    \"last_whatsapp_message\": $(echo "$MESSAGE" | jq -Rs '.[:200]')
}" 2>/dev/null

echo "{\"success\": true, \"channel\": \"$CHANNEL\", \"contact\": \"$NAME\", \"sent_at\": \"$NOW\"}"
