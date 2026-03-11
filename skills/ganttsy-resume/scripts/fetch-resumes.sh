#!/usr/bin/env bash
# Resilient version: removed set -e to prevent early exits on expected failures
# Keep pipefail for debugging, but handle errors explicitly
set -uo pipefail

BASEDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Use writable dirs exported by run-daily.sh; fall back to group workspace defaults
STATE_DIR="${STATE_DIR:-/workspace/group/ganttsy-resume/.state}"
RAW_DIR="${RAW_DIR:-/workspace/group/ganttsy-resume/candidates/raw}"
STATE_FILE="$STATE_DIR/processed_ids.txt"
TOKEN_FILE="/workspace/extra/credentials/ganttsy-google-token.json"

QUERY_DEFAULT='to:careers@ganttsy.com'
QUERY="${QUERY:-$QUERY_DEFAULT}"

mkdir -p "$STATE_DIR" "$RAW_DIR"
touch "$STATE_FILE"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Token file not found: $TOKEN_FILE" >&2
  exit 1
fi

get_access_token() {
  local client_id client_secret refresh_token
  client_id=$(jq -r '.installed.client_id // .client_id' "$TOKEN_FILE")
  client_secret=$(jq -r '.installed.client_secret // .client_secret' "$TOKEN_FILE")
  refresh_token=$(jq -r '.refresh_token' "$TOKEN_FILE")

  curl -s -X POST https://oauth2.googleapis.com/token \
    -d client_id="$client_id" \
    -d client_secret="$client_secret" \
    -d refresh_token="$refresh_token" \
    -d grant_type=refresh_token | jq -r '.access_token'
}

urlencode() {
  node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$1"
}

ACCESS_TOKEN=$(get_access_token)
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
  echo "Failed to get access token" >&2
  exit 1
fi

ENC_QUERY=$(urlencode "$QUERY")

MSG_LIST=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=$ENC_QUERY&maxResults=500")

MSG_IDS=$(echo "$MSG_LIST" | jq -r '.messages[]?.id')

new_count=0
for id in $MSG_IDS; do
  if grep -qx "$id" "$STATE_FILE"; then
    continue
  fi

  msg=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id?format=full")

  attachments=$(echo "$msg" | jq -r '.. | objects | select(has("filename") and .filename!="") | select(.body.attachmentId!=null) | [.filename, .body.attachmentId, .mimeType] | @tsv')

  downloaded=0
  has_attachment=false
  while IFS=$'\t' read -r filename attId mimeType; do
    [[ -z "$filename" || -z "$attId" ]] && continue

    has_attachment=true

    case "$mimeType" in
      application/pdf|application/vnd.openxmlformats-officedocument.wordprocessingml.document|application/msword)
        ;;
      *)
        continue
        ;;
    esac

    safe_name=$(echo "$filename" | tr ' ' '_' | tr -cd '[:alnum:]._-' )
    out_file="$RAW_DIR/${id}_${safe_name}"
    if [[ -f "$out_file" ]]; then
      continue
    fi

    att_json=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/$id/attachments/$attId")
    echo "$att_json" | jq -r '.data' | \
      node -e "
let d='';
process.stdin.on('data',c=>{d+=c;});
process.stdin.on('end',()=>{
  d=d.trim().replace(/-/g,'+').replace(/_/g,'/');
  const pad='='.repeat((-d.length%4+4)%4);
  process.stdout.write(Buffer.from(d+pad,'base64'));
});" > "$out_file"

    if [[ -s "$out_file" ]]; then
      downloaded=$((downloaded+1))
      new_count=$((new_count+1))
    fi
  done <<< "$attachments"

  # If no attachment found, save full email body to .md file for manual review
  if [[ "$has_attachment" == "false" ]]; then
    # Get sender info
    sender=$(echo "$msg" | jq -r '.payload.headers[] | select(.name=="From") | .value' 2>/dev/null || echo "Unknown")
    subject=$(echo "$msg" | jq -r '.payload.headers[] | select(.name=="Subject") | .value' 2>/dev/null || echo "No Subject")

    no_resume_md="$BASEDIR/candidates/md/${id}_NO_ATTACHMENT.md"
    no_resume_json="$BASEDIR/candidates/md/${id}_NO_ATTACHMENT.json"

    if [[ ! -f "$no_resume_md" ]]; then
      # Extract full email body text
      temp_msg_file=$(mktemp)
      echo "$msg" > "$temp_msg_file"

      # Extract all text content from email (plain text and html parts)
      email_body=$(node "$BASEDIR/scripts/lib/email-body.cjs" --body "$temp_msg_file" 2>/dev/null || echo "(Could not extract email body)")

      rm -f "$temp_msg_file"

      # Write full email body to .md file
      cat > "$no_resume_md" << EOF
# No Resume Attached

**From:** $sender
**Subject:** $subject
**Message ID:** $id

---

## Email Body

$email_body

EOF

      # Basic metadata from sender
      node -e "
const sender=process.argv[1];
const m=sender.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
const email=m?m[0]:'';
const name=sender.replace(/<[^>]+>/g,'').trim().replace(/^\"+|\"+$/g,'').replace(/^'+|'+$/g,'');
const meta={name,email,experience:'No resume - manual review required',skills:[]};
require('fs').writeFileSync(process.argv[2],JSON.stringify(meta,null,2));
" "$sender" "$no_resume_json"

      new_count=$((new_count+1))
      echo "NO_ATTACHMENT: Saved full email body for $id" >&2
    fi
  fi

  echo "$id" >> "$STATE_FILE"

done

echo "NEW_RESUMES=$new_count"
