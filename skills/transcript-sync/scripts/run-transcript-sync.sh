#!/usr/bin/env bash
set -uo pipefail

SKILLS_DIR="/workspace/extra/skills/transcript-sync"
SCRIPTS_DIR="$SKILLS_DIR/scripts"
GITHUB_ROOT="${GITHUB_ROOT:-/workspace/extra/github}"
GROUP_WORKSPACE="${GROUP_WORKSPACE:-/workspace/group/transcript-sync}"
GITHUB_TOKEN_FILE="/workspace/extra/credentials/github-transcript-token"

mkdir -p "$GROUP_WORKSPACE"

# Copy Shadow DB to /tmp so better-sqlite3 can open it (WAL mode needs writable dir)
SHADOW_SRC="/workspace/extra/shadow/shadow.db"
SHADOW_TMP="/tmp/shadow-work.db"
if [[ -f "$SHADOW_SRC" ]]; then
  cp "$SHADOW_SRC" "$SHADOW_TMP"
  export SHADOW_DB_PATH="$SHADOW_TMP"
fi

# Install deps if missing (skills dir is writable in container)
if [[ ! -d "$SKILLS_DIR/node_modules" ]]; then
  echo "Installing transcript-sync npm dependencies..." >&2
  cd "$SKILLS_DIR" && npm install --silent
fi

# Install linear skill deps if missing (needed by transcript-to-linear-llm.ts)
LINEAR_SCRIPTS_DIR="/workspace/extra/skills/linear/scripts"
if [[ -d "$LINEAR_SCRIPTS_DIR" ]] && [[ ! -d "$LINEAR_SCRIPTS_DIR/node_modules" ]]; then
  echo "Installing linear npm dependencies..." >&2
  cd "$LINEAR_SCRIPTS_DIR" && npm install --silent
fi

# Run the main transcript-sync script (stdout = JSON manifest of written files)
echo "Running transcript-sync..." >&2
cd "$SCRIPTS_DIR"
TS_OUTPUT=$("$SKILLS_DIR/node_modules/.bin/tsx" transcript-sync.ts "$@")
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "transcript-sync.ts exited with code $EXIT_CODE" >&2
  exit $EXIT_CODE
fi

# Parse written files from stdout JSON
WRITTEN_FILES=""
if [[ -n "$TS_OUTPUT" ]]; then
  # Extract writtenFiles array from JSON, one path per line
  WRITTEN_FILES=$(echo "$TS_OUTPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for f in data.get('writtenFiles', []):
        print(f)
except: pass
" 2>/dev/null)
fi

if [[ -z "$WRITTEN_FILES" ]]; then
  echo "No files written, nothing to commit." >&2
  exit 0
fi

echo "Transcript sync complete. Committing written files..." >&2

# Set git identity (required in container)
git config --global user.email "cleo@nanoclaw" 2>/dev/null || true
git config --global user.name "Cleo" 2>/dev/null || true

# Get GitHub token for push
if [[ ! -f "$GITHUB_TOKEN_FILE" ]]; then
  echo "WARNING: No GitHub token at $GITHUB_TOKEN_FILE — skipping git push" >&2
  exit 0
fi
TOKEN=$(cat "$GITHUB_TOKEN_FILE")

# Group written files by git repo and commit only those specific files
declare -A REPO_FILES
while IFS= read -r filepath; do
  [[ -z "$filepath" ]] && continue
  # Walk up to find .git root
  dir=$(dirname "$filepath")
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/.git" ]]; then
      REPO_FILES["$dir"]+="$filepath"$'\n'
      break
    fi
    dir=$(dirname "$dir")
  done
done <<< "$WRITTEN_FILES"

for repo_dir in "${!REPO_FILES[@]}"; do
  cd "$repo_dir"
  label=$(basename "$repo_dir")

  # Stage only the specific files transcript-sync wrote
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    git add "$f"
  done <<< "${REPO_FILES[$repo_dir]}"

  if git diff --cached --quiet; then
    continue
  fi

  git commit -m "Update transcripts [automated]" || continue

  REMOTE_URL=$(git remote get-url origin 2>/dev/null) || continue
  AUTHED_URL=$(echo "$REMOTE_URL" | sed "s|https://|https://x-token:${TOKEN}@|")
  git push "$AUTHED_URL" && echo "Pushed: $label" >&2 || echo "Push failed for: $label" >&2
done

echo "Done." >&2
