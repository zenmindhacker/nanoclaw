#!/bin/bash
# Script gate for catch-up auditor.
# Checks if daily tasks were missed. Only wakes agent if something needs re-running.
set -uo pipefail

TASKS_FILE="/workspace/ipc/current_tasks.json"
if [[ ! -f "$TASKS_FILE" ]]; then
  echo '{"wakeAgent": false}'
  exit 0
fi

TODAY=$(TZ=America/Costa_Rica date +%Y-%m-%d)
NOW_H=$(TZ=America/Costa_Rica date +%H)
NOW_MIN=$(( $(TZ=America/Costa_Rica date +%H) * 60 + $(TZ=America/Costa_Rica date +%M) ))

missed=""

# Check each cron task for missed daily runs
while IFS= read -r line; do
  id=$(echo "$line" | jq -r '.id')
  schedule=$(echo "$line" | jq -r '.schedule_value')
  last_run=$(echo "$line" | jq -r '.last_run // "never"')

  # Only check daily tasks (cron with specific hour, not */N or ranges)
  hour=$(echo "$schedule" | awk '{print $2}')
  # Skip tasks that run more than once per hour (transcript-sync etc)
  if echo "$schedule" | grep -qE '^[0-9,]+\s'; then
    minute_field=$(echo "$schedule" | awk '{print $1}')
    if echo "$minute_field" | grep -q ','; then
      continue  # runs multiple times per hour, skip
    fi
  fi

  # Skip if hour is wildcard or range
  if echo "$hour" | grep -qE '^\*|/|,'; then
    continue
  fi

  # Parse scheduled time in minutes
  minute=$(echo "$schedule" | awk '{print $1}')
  [[ "$minute" == "*" ]] && minute=0
  scheduled_min=$(( hour * 60 + minute ))

  # Only check if we're past the scheduled time + 30m grace
  if [[ $NOW_MIN -lt $(( scheduled_min + 30 )) ]]; then
    continue
  fi

  # Check if last_run was today
  if [[ "$last_run" == "never" ]] || [[ "${last_run:0:10}" < "$TODAY" ]]; then
    missed="$missed $id(scheduled=${hour}:${minute})"
  fi
done < <(jq -c '.[]' "$TASKS_FILE" 2>/dev/null)

if [[ -n "$missed" ]]; then
  echo "{\"wakeAgent\": true, \"data\": {\"missed\": \"${missed# }\", \"today\": \"$TODAY\", \"now_min\": $NOW_MIN}}"
else
  echo '{"wakeAgent": false}'
fi
