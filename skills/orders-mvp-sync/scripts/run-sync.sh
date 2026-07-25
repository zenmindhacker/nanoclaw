#!/usr/bin/env bash
# orders-mvp sync helper for Silas (agent-invoked — NOT a NanoClaw pre-task script).
# Loads host credentials, points Google CLIs at shadow-google, runs sync_all (welcome ON).
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
      echo "ERROR: git pull --ff-only failed in $REPO (no github-transcript-token)" >&2
      exit 3
    }
  fi
fi

if [[ ! -f "$REPO/.env" ]]; then
  echo "ERROR: missing $REPO/.env (need GA_ODYSSEY_USERNAME / GA_ODYSSEY_PASSWORD)" >&2
  exit 4
fi

export CT_SHEETS_CT="${CT_SHEETS_CT:-${GW_BIN}/sheets-ct.mjs}"
export CT_DRIVE_CT="${CT_DRIVE_CT:-${GW_BIN}/drive-ct.mjs}"
export CT_SEND_EMAIL="${CT_SEND_EMAIL:-${GW_BIN}/send-email.mjs}"
export CT_GOOGLE_ACCESS_TOKEN="${CT_GOOGLE_ACCESS_TOKEN:-${GW_LIB}/access-token.mjs}"
export CT_GOOGLE_REGISTRY="${CT_GOOGLE_REGISTRY:-shadow-google}"

export_cred QUO_API_KEY quo.api_key
# Connected Tutors (and all CT orgs) share the Cognitive Tech / CTCI eSignatures account.
export_cred ESIGNATURES_API_TOKEN esignatures-cognitive
if [[ -z "${ESIGNATURES_API_TOKEN:-}" ]]; then
  export_cred ESIGNATURES_API_TOKEN esignatures.cognitive
fi
export_cred TEACHWORKS_API_KEY teachworks.api_key
export_cred TEACHWORKS_WEB_EMAIL teachworks.web_email
export_cred TEACHWORKS_WEB_PASSWORD teachworks.web_password

for cli in "$CT_SHEETS_CT" "$CT_DRIVE_CT" "$CT_SEND_EMAIL"; do
  if [[ ! -f "$cli" ]]; then
    echo "ERROR: Google CLI missing: $cli" >&2
    exit 5
  fi
done
if [[ -z "${QUO_API_KEY:-}" ]]; then
  echo "ERROR: QUO_API_KEY missing (welcome SMS)" >&2
  exit 6
fi

cd "$REPO/orders-mvp"

# Cross-container single-flight: claim a new run id first so any in-flight
# sync_all (other Silas containers) exits at the next step boundary, then
# take an exclusive flock on the shared repo mount.
LOCK_FILE="$REPO/orders-mvp/.orders-mvp-sync.lock"
RUN_ID_FILE="$REPO/orders-mvp/.orders-mvp-sync.runid"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM:-0}"
printf '%s\n' "$RUN_ID" >"$RUN_ID_FILE"
export CT_SYNC_RUN_ID="$RUN_ID"
echo "==> claiming sync run id=$RUN_ID (preempts lingering runs)"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "==> prior sync still holds lock — waiting up to 120s for it to yield..."
  if ! flock -w 120 9; then
    echo "ERROR: could not acquire orders-mvp sync lock after 120s" >&2
    exit 7
  fi
fi
# Re-assert after wait in case another waiter raced.
printf '%s\n' "$RUN_ID" >"$RUN_ID_FILE"

echo "==> orders-mvp sync_all (welcome email/SMS enabled)"
set +e
python3 sync_all.py "$@"
rc=$?
set -e
echo "==> sync_all exit_code=$rc"
exit "$rc"
