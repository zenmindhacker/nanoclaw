#!/usr/bin/env bash
set -euo pipefail

GITHUB_ROOT="${GITHUB_ROOT:-/workspace/extra/github}"
TARGET_DIR="${TARGET_DIR:-$GITHUB_ROOT/ganttsy/ganttsy-strategy/team/designer-resumes}"

# GitHub PAT for HTTPS push (osxkeychain not available in container).
# Store token at ~/.config/nanoclaw/credentials/services/ganttsy-github-token
# and add it to the scheduled group's container_config mounts.
GITHUB_TOKEN_FILE="/workspace/extra/credentials/ganttsy-github-token"

# Find git repo (could be in TARGET_DIR or parent)
GIT_DIR="$TARGET_DIR"
while [[ "$GIT_DIR" != "/" && ! -d "$GIT_DIR/.git" ]]; do
  GIT_DIR="$(dirname "$GIT_DIR")"
done

if [[ ! -d "$GIT_DIR/.git" ]]; then
  echo "Not a git repo: $TARGET_DIR" >&2
  exit 1
fi

cd "$GIT_DIR"

# Ensure git identity is set (required in container)
git config user.email 2>/dev/null | grep -q '@' || git config user.email "cleo@nanoclaw"
git config user.name 2>/dev/null | grep -q '.' || git config user.name "Cleo"

git add .
if git diff --cached --quiet; then
  echo "No changes to commit"
  exit 0
fi

git commit -m "Update designer resumes and evaluation grid [automated]"

# Push using PAT if available, otherwise try default (may fail in container)
if [[ -f "$GITHUB_TOKEN_FILE" ]]; then
  TOKEN=$(cat "$GITHUB_TOKEN_FILE")
  REMOTE_URL=$(git remote get-url origin)
  # Inject token into HTTPS URL: https://github.com/... -> https://TOKEN@github.com/...
  AUTHED_URL=$(echo "$REMOTE_URL" | sed "s|https://|https://x-token:${TOKEN}@|")
  git push "$AUTHED_URL"
else
  echo "WARNING: No GitHub token at $GITHUB_TOKEN_FILE — attempting push without auth" >&2
  git push
fi
