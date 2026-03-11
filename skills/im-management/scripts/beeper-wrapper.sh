#!/bin/bash
# beeper-wrapper.sh - Helper for Beeper API calls
# Auto-loads token from credentials file

BEEPER_TOKEN=$(cat /workspace/extra/credentials/beeper)
BASE_URL="http://host.containers.internal:23373"

# Helper function
beeper_api() {
    local METHOD=${1:-GET}
    local ENDPOINT=$2
    shift 2
    
    curl -s -X "$METHOD" \
        -H "Authorization: Bearer $BEEPER_TOKEN" \
        -H "Content-Type: application/json" \
        "${BASE_URL}${ENDPOINT}" \
        "$@"
}

# Commands
case $1 in
    accounts)
        beeper_api GET "/v1/accounts"
        ;;
        
    chats)
        LIMIT=${2:-50}
        NETWORK=$3
        if [ -n "$NETWORK" ]; then
            beeper_api GET "/v1/chats?limit=$LIMIT" | jq "[.items[] | select(.network == \"$NETWORK\")]"
        else
            beeper_api GET "/v1/chats?limit=$LIMIT"
        fi
        ;;
        
    messages)
        CHAT_ID=$2
        LIMIT=${3:-20}
        if [ -z "$CHAT_ID" ]; then
            echo "Usage: beeper-wrapper.sh messages <chat-id> [limit]" >&2
            exit 1
        fi
        ENCODED_ID=$(echo -n "$CHAT_ID" | jq -sRr @uri)
        beeper_api GET "/v1/chats/$ENCODED_ID/messages?limit=$LIMIT"
        ;;
        
    send)
        CHAT_ID=$2
        MESSAGE=$3
        if [ -z "$CHAT_ID" ] || [ -z "$MESSAGE" ]; then
            echo "Usage: beeper-wrapper.sh send <chat-id> <message>" >&2
            exit 1
        fi
        ENCODED_ID=$(echo -n "$CHAT_ID" | jq -sRr @uri)
        beeper_api POST "/v1/chats/$ENCODED_ID/messages" -d "{\"text\": $(echo "$MESSAGE" | jq -Rs .)}"
        ;;
        
    search)
        QUERY=$2
        if [ -z "$QUERY" ]; then
            echo "Usage: beeper-wrapper.sh search <query>" >&2
            exit 1
        fi
        beeper_api GET "/v1/chats/search?q=$(echo -n "$QUERY" | jq -sRr @uri)"
        ;;
        
    info)
        beeper_api GET "/v1/info"
        ;;
        
    *)
        echo "Beeper API Wrapper"
        echo ""
        echo "Usage: beeper-wrapper.sh <command> [args]"
        echo ""
        echo "Commands:"
        echo "  accounts              List connected accounts"
        echo "  chats [limit] [net]   List chats (optional network filter)"
        echo "  messages <id> [lim]   Get messages from chat"
        echo "  send <id> <msg>       Send message to chat"
        echo "  search <query>        Search chats"
        echo "  info                  Get server info"
        ;;
esac
