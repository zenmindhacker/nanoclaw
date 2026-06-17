#!/bin/bash
# weekly-audit.sh - Find duplicates, missing fields, stale records
# Output: JSON for agent to process and decide actions

set -e

ATTIO_WRAPPER=/workspace/extra/skills/attio/scripts/attio-wrapper.sh
IM_LIST_ID="569a3e1a-84e1-4fd0-9aab-39f7f0a64483"

NOW=$(date -u +%s)
WEEK_AGO=$(date -v-7d -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "7 days ago" -u +%Y-%m-%dT%H:%M:%SZ)
SIX_MONTHS_AGO=$(date -v-180d -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "180 days ago" -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== Weekly IM Audit ===" >&2
echo "Checking records created since: $WEEK_AGO" >&2

# Get all IM List entries
ENTRIES=$($ATTIO_WRAPPER entries list "$IM_LIST_ID" --limit 500 --json 2>/dev/null)
ENTRY_COUNT=$(echo "$ENTRIES" | jq 'length')
echo "Total IM List entries: $ENTRY_COUNT" >&2

# Build arrays for analysis (removed - not needed for this logic)
DUPLICATES=()
MISSING_FIELDS=()
STALE_RECORDS=()

echo "{"
echo "  \"audit_time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
echo "  \"total_entries\": $ENTRY_COUNT,"

# Check for duplicates and missing fields
echo "  \"duplicates\": ["
FIRST_DUP=true

echo "$ENTRIES" | jq -c '.[]' | while read -r entry; do
    RECORD_ID=$(echo "$entry" | jq -r '.id.record_id')
    
    # Get person details
    PERSON=$($ATTIO_WRAPPER records get people "$RECORD_ID" --json 2>/dev/null)
    NAME=$(echo "$PERSON" | jq -r '.values.name[0].full_name // ""')
    PHONE=$(echo "$PERSON" | jq -r '.values.phone_numbers[0].phone_number // ""')
    CREATED=$(echo "$PERSON" | jq -r '.created_at // ""')
    
    # Check for phone duplicates (output for agent)
    if [ -n "$PHONE" ] && [ "$PHONE" != "null" ]; then
        # Search for others with same phone
        MATCHES=$($ATTIO_WRAPPER people list --search "$PHONE" --json 2>/dev/null | jq 'length')
        if [ "$MATCHES" -gt 1 ]; then
            if [ "$FIRST_DUP" = true ]; then
                FIRST_DUP=false
            else
                echo ","
            fi
            echo "    {\"type\": \"phone_duplicate\", \"phone\": \"$PHONE\", \"record_id\": \"$RECORD_ID\", \"name\": \"$NAME\", \"match_count\": $MATCHES}"
        fi
    fi
done

echo "  ],"

# Check for missing required fields
echo "  \"missing_fields\": ["
FIRST_MISSING=true

echo "$ENTRIES" | jq -c '.[]' | while read -r entry; do
    RECORD_ID=$(echo "$entry" | jq -r '.id.record_id')
    PRIORITY=$(echo "$entry" | jq -r '.entry_values.priority[0].option.title // ""')
    
    PERSON=$($ATTIO_WRAPPER records get people "$RECORD_ID" --json 2>/dev/null)
    NAME=$(echo "$PERSON" | jq -r '.values.name[0].full_name // "Unknown"')
    PHONE=$(echo "$PERSON" | jq -r '.values.phone_numbers[0].phone_number // ""')
    LAST_IM=$(echo "$PERSON" | jq -r '.values.last_im_date[0].value // ""')
    
    MISSING=()
    
    # Check relationship tier
    if [ -z "$PRIORITY" ] || [ "$PRIORITY" = "null" ]; then
        MISSING+=("relationship_tier")
    fi
    
    # Check contact method
    if [ -z "$PHONE" ] || [ "$PHONE" = "null" ]; then
        MISSING+=("phone_number")
    fi
    
    # Check last contact date
    if [ -z "$LAST_IM" ] || [ "$LAST_IM" = "null" ]; then
        MISSING+=("last_im_date")
    fi
    
    if [ ${#MISSING[@]} -gt 0 ]; then
        if [ "$FIRST_MISSING" = true ]; then
            FIRST_MISSING=false
        else
            echo ","
        fi
        MISSING_JSON=$(printf '%s\n' "${MISSING[@]}" | jq -R . | jq -s .)
        echo "    {\"record_id\": \"$RECORD_ID\", \"name\": \"$NAME\", \"missing\": $MISSING_JSON}"
    fi
done

echo "  ],"

# Check for stale records (6+ months, not archived)
echo "  \"stale_records\": ["
FIRST_STALE=true

echo "$ENTRIES" | jq -c '.[]' | while read -r entry; do
    RECORD_ID=$(echo "$entry" | jq -r '.id.record_id')
    PRIORITY=$(echo "$entry" | jq -r '.entry_values.priority[0].option.title // ""')
    
    # Skip archived
    if [ "$PRIORITY" = "Archived" ]; then
        continue
    fi
    
    PERSON=$($ATTIO_WRAPPER records get people "$RECORD_ID" --json 2>/dev/null)
    NAME=$(echo "$PERSON" | jq -r '.values.name[0].full_name // "Unknown"')
    LAST_IM=$(echo "$PERSON" | jq -r '.values.last_im_date[0].value // ""')
    
    if [ -n "$LAST_IM" ] && [ "$LAST_IM" != "null" ]; then
        LAST_IM_EPOCH=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_IM%%.*}" +%s 2>/dev/null || echo "0")
        DAYS_SINCE=$(( (NOW - LAST_IM_EPOCH) / 86400 ))
        
        if [ $DAYS_SINCE -gt 180 ]; then
            if [ "$FIRST_STALE" = true ]; then
                FIRST_STALE=false
            else
                echo ","
            fi
            echo "    {\"record_id\": \"$RECORD_ID\", \"name\": \"$NAME\", \"days_since_contact\": $DAYS_SINCE, \"tier\": \"$PRIORITY\"}"
        fi
    fi
done

echo "  ]"
echo "}"
