#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${TARGET_DIR:-/Users/cian/Documents/GitHub/ganttsy/ganttsy-strategy/team/designer-resumes}"

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

git add .
if git diff --cached --quiet; then
  echo "No changes to commit"
  exit 0
fi

git commit -m "Update designer resumes and evaluation grid"

git push
