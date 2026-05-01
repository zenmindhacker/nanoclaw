#!/bin/bash
# Script gate for OAuth health check.
# Only wakes agent if tokens are expired or missing.
set -uo pipefail

expired=""
errors=""
ok_count=0

for f in /workspace/extra/credentials/*-token.json; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .json)
  expires_at=$(jq -r ".expires_at // empty" "$f" 2>/dev/null)
  has_refresh=$(jq -r ".refresh_token // empty" "$f" 2>/dev/null)

  if [ -z "$expires_at" ]; then
    errors="$errors $name(no_expiry)"
    continue
  fi

  now=$(date +%s)
  remaining=$(( expires_at - now ))

  if [ $remaining -lt 0 ]; then
    mins_ago=$(( -remaining / 60 ))
    expired="$expired $name(expired_${mins_ago}m_ago)"
  elif [ -z "$has_refresh" ]; then
    errors="$errors $name(no_refresh_token)"
  else
    ok_count=$((ok_count + 1))
  fi
done

if [ -n "$expired" ] || [ -n "$errors" ]; then
  echo "{\"wakeAgent\": true, \"data\": {\"expired\": \"${expired# }\", \"errors\": \"${errors# }\", \"ok_count\": $ok_count}}"
else
  echo "{\"wakeAgent\": false}"
fi
