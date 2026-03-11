#!/usr/bin/env bash
set -uo pipefail

SKILLS_DIR="/workspace/extra/skills/transcript-sync"
SCRIPTS_DIR="$SKILLS_DIR/scripts"
GITHUB_ROOT="${GITHUB_ROOT:-/workspace/extra/github}"
GROUP_WORKSPACE="${GROUP_WORKSPACE:-/workspace/group/transcript-sync}"
GITHUB_TOKEN_FILE="/workspace/extra/credentials/github-transcript-token"

mkdir -p "$GROUP_WORKSPACE"

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

# Run the main transcript-sync script
echo "Running transcript-sync..." >&2
cd "$SCRIPTS_DIR"
"$SKILLS_DIR/node_modules/.bin/tsx" transcript-sync.ts "$@"
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "transcript-sync.ts exited with code $EXIT_CODE" >&2
  exit $EXIT_CODE
fi

echo "Transcript sync complete. Committing changed repos..." >&2

# Set git identity (required in container)
git config --global user.email "cleo@nanoclaw" 2>/dev/null || true
git config --global user.name "Cleo" 2>/dev/null || true

# Get GitHub token for push
if [[ ! -f "$GITHUB_TOKEN_FILE" ]]; then
  echo "WARNING: No GitHub token at $GITHUB_TOKEN_FILE — skipping git push" >&2
  exit 0
fi
TOKEN=$(cat "$GITHUB_TOKEN_FILE")

commit_and_push() {
  local repo_dir="$1"
  local label="$2"

  [[ -d "$repo_dir/.git" ]] || return 0

  cd "$repo_dir"

  # Check for changes
  if git diff --quiet && git diff --cached --quiet && [[ -z "$(git ls-files --others --exclude-standard)" ]]; then
    return 0
  fi

  git add .
  if git diff --cached --quiet; then
    return 0
  fi

  git commit -m "Update transcripts [automated]" || return 1

  local REMOTE_URL
  REMOTE_URL=$(git remote get-url origin 2>/dev/null) || return 1
  local AUTHED_URL
  AUTHED_URL=$(echo "$REMOTE_URL" | sed "s|https://|https://x-token:${TOKEN}@|")
  git push "$AUTHED_URL" && echo "Pushed: $label" >&2 || echo "Push failed for: $label" >&2
}

# Commit each repo that transcript-sync writes to
commit_and_push "$GITHUB_ROOT/ganttsy/ganttsy-docs" "ganttsy-docs"
commit_and_push "$GITHUB_ROOT/ganttsy/ganttsy-strategy" "ganttsy-strategy"
commit_and_push "$GITHUB_ROOT/copperteams/ct-docs" "ct-docs"
commit_and_push "$GITHUB_ROOT/cognitivetech/ctci-docs" "ctci-docs"
commit_and_push "$GITHUB_ROOT/cognitivetech/coaching" "cognitivetech-coaching"
commit_and_push "$GITHUB_ROOT/nvs/nvs-docs" "nvs-docs"

echo "Done." >&2
