#!/usr/bin/env bash
# Friday TeachWorks completion reminders for tutors (Silas / NanoClaw).
# Loads host credentials, points Google at shadow-google (hello@), sends digests.
set -euo pipefail

REPO="${CT_REPO:-/workspace/extra/repos/connected-tutoring}"
GW_BIN="${CT_GOOGLE_BIN:-/workspace/extra/skills/google-workspace/bin}"
GW_LIB="${CT_GOOGLE_LIB:-/workspace/extra/skills/google-workspace/lib}"
CREDS_A="/workspace/extra/credentials"
CREDS_B="/workspace/extra/credentials/services"
HOST_CREDS="${HOME}/.config/nanoclaw/credentials/services"

read_cred() {
  local name="$1"
  for base in "$CREDS_A" "$CREDS_B" "$HOST_CREDS"; do
    if [[ -f "${base}/${name}" ]]; then
      tr -d '\n' <"${base}/${name}"
      return 0
    fi
  done
  return 1
}

export_cred() {
  local env_name="$1"
  local file_name="$2"
  if [[ -n "${!env_name:-}" ]]; then
    return 0
  fi
  local val
  if val="$(read_cred "$file_name")"; then
    export "${env_name}=${val}"
  fi
}

if [[ ! -d "$REPO" ]]; then
  echo "ERROR: connected-tutoring repo not mounted at $REPO" >&2
  exit 2
fi

cd "$REPO"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_TOKEN=""
  if GIT_TOKEN="$(read_cred github-transcript-token 2>/dev/null)"; then
    :
  fi
  if [[ -n "$GIT_TOKEN" ]]; then
    git -c "url.https://x-access-token:${GIT_TOKEN}@github.com/.insteadOf=https://github.com/" pull --ff-only || {
      echo "ERROR: git pull --ff-only failed in $REPO" >&2
      exit 3
    }
  else
    git pull --ff-only || {
      echo "ERROR: git pull --ff-only failed in $REPO" >&2
      exit 3
    }
  fi
fi

export CT_SHEETS_CT="${CT_SHEETS_CT:-${GW_BIN}/sheets-ct.mjs}"
export CT_DRIVE_CT="${CT_DRIVE_CT:-${GW_BIN}/drive-ct.mjs}"
export CT_SEND_EMAIL="${CT_SEND_EMAIL:-${GW_BIN}/send-email.mjs}"
export CT_GOOGLE_ACCESS_TOKEN="${CT_GOOGLE_ACCESS_TOKEN:-${GW_LIB}/access-token.mjs}"
export CT_GOOGLE_REGISTRY="${CT_GOOGLE_REGISTRY:-shadow-google}"

export_cred TEACHWORKS_API_KEY teachworks.api_key

cd "$REPO/orders-mvp"
# Refresh TW Lessons mirror, then email tutors with past incomplete sessions.
python3 send_tutor_completion_reminders.py --refresh-tw-lessons --send "$@"
