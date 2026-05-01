#!/bin/bash
# Script gate for transcript-sync scheduled task.
# Runs the pipeline without waking the agent. Only wakes if files were written or errors occurred.
set -uo pipefail

SKILLS_DIR="/workspace/extra/skills/transcript-sync"
SCRIPTS_DIR="$SKILLS_DIR/scripts"
GITHUB_TOKEN_FILE="/workspace/extra/credentials/github-transcript-token"

# Copy Shadow DB to /tmp (WAL mode needs writable dir)
SHADOW_SRC="/workspace/extra/shadow/shadow.db"
SHADOW_TMP="/tmp/shadow-work.db"
if [[ -f "$SHADOW_SRC" ]]; then
  cp "$SHADOW_SRC" "$SHADOW_TMP"
  export SHADOW_DB_PATH="$SHADOW_TMP"
fi

# Install deps if missing
if [[ ! -d "$SKILLS_DIR/node_modules" ]]; then
  cd "$SKILLS_DIR" && npm install --silent 2>&1 >&2
fi

# Run transcript-sync, capture stdout (JSON manifest), logs go to stderr
cd "$SCRIPTS_DIR"
TS_OUTPUT=$("$SKILLS_DIR/node_modules/.bin/tsx" transcript-sync.ts --tasks-mode off 2>/tmp/ts-stderr.txt)
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  STDERR_TAIL=$(tail -5 /tmp/ts-stderr.txt 2>/dev/null | tr '\n' ' ')
  echo "{\"wakeAgent\": true, \"data\": {\"error\": true, \"exitCode\": $EXIT_CODE, \"stderr\": \"$STDERR_TAIL\"}}"
  exit 0
fi

# Check if any files were written
if [[ -z "$TS_OUTPUT" ]]; then
  echo '{"wakeAgent": false}'
  exit 0
fi

WRITTEN_FILES=$(echo "$TS_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for f in data.get('writtenFiles', []):
        print(f)
except: pass
" 2>/dev/null)

if [[ -z "$WRITTEN_FILES" ]]; then
  echo '{"wakeAgent": false}'
  exit 0
fi

# Files were written — do git commit/push
git config --global user.email "cleo@nanoclaw" 2>/dev/null || true
git config --global user.name "Cleo" 2>/dev/null || true

TOKEN=""
if [[ -f "$GITHUB_TOKEN_FILE" ]]; then
  TOKEN=$(cat "$GITHUB_TOKEN_FILE")
fi

declare -A REPO_FILES
while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
  dir=$(dirname "$filepath")
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.git" ]]; then
      REPO_FILES["$dir"]+="$filepath"$'\n'
      break
    fi
    dir=$(dirname "$dir")
  done
done <<< "$WRITTEN_FILES"

pushed_repos=""
for repo_dir in "${!REPO_FILES[@]}"; do
  cd "$repo_dir"
  label=$(basename "$repo_dir")

  # Pull latest before committing
  if [[ -n "$TOKEN" ]]; then
    REMOTE_URL=$(git remote get-url origin 2>/dev/null) || true
    if [[ -n "$REMOTE_URL" ]]; then
      AUTHED_URL=$(echo "$REMOTE_URL" | sed "s|https://|https://x-token:${TOKEN}@|")
      git pull --rebase "$AUTHED_URL" 2>&1 >/dev/null || true
    fi
  fi

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    git add "$f"
  done <<< "${REPO_FILES[$repo_dir]}"

  if git diff --cached --quiet; then continue; fi
  git commit -m "Update transcripts [automated]" 2>&1 >/dev/null || continue

  if [[ -n "$TOKEN" ]]; then
    REMOTE_URL=$(git remote get-url origin 2>/dev/null) || true
    AUTHED_URL=$(echo "$REMOTE_URL" | sed "s|https://|https://x-token:${TOKEN}@|")
    git push "$AUTHED_URL" 2>&1 >/dev/null && pushed_repos="$pushed_repos $label"
  fi
done

FILE_COUNT=$(echo "$WRITTEN_FILES" | grep -c .)
FILE_LIST=$(echo "$WRITTEN_FILES" | xargs -I{} basename {} | tr '\n' ', ' | sed 's/,$//')
echo "{\"wakeAgent\": true, \"data\": {\"filesWritten\": $FILE_COUNT, \"files\": \"$FILE_LIST\", \"pushed\": \"${pushed_repos# }\"}}"
