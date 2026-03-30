#!/usr/bin/env bash
# load-secrets.sh — Load nanoclaw secrets from macOS Keychain into env vars.
#
# Usage (source it, don't execute):
#   source ~/nanoclaw/scripts/load-secrets.sh [group]
#
# Group defaults to "main". Only loads secrets assigned to that group.
# Also sets path env vars (CREDENTIALS_ROOT, SKILLS_ROOT, etc.) for local execution.
#
# Example:
#   source ~/nanoclaw/scripts/load-secrets.sh
#   bash ~/nanoclaw/skills/linear/scripts/linear-router.sh ganttsy my

# No strict mode — this file is sourced, not executed

GROUP="${1:-main}"
# Works in both bash (BASH_SOURCE) and zsh (%x)
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
MANIFEST="$_SCRIPT_DIR/../data/secrets-manifest.json"
KEYCHAIN_SERVICE="nanoclaw-secrets"
CREDS_DIR="$HOME/.config/nanoclaw/credentials/services"

if [[ ! -f "$MANIFEST" ]]; then
  echo "[load-secrets] Manifest not found: $MANIFEST" >&2
  return 1 2>/dev/null || exit 1
fi

# Set standard path overrides for local (non-container) execution
export CREDENTIALS_ROOT="$CREDS_DIR"
export SKILLS_ROOT="$HOME/nanoclaw/skills"
export GITHUB_ROOT="$HOME/Documents/GitHub"
export GROUP_WORKSPACE="$HOME/nanoclaw/groups/main/transcript-sync"
export CLAUDE_SCRIPTS_DIR="$HOME/.claude/scripts"

loaded=0
failed=0

# Parse manifest and load static secrets from Keychain
while IFS= read -r line; do
  name=$(echo "$line" | cut -d'|' -f1)
  env_var=$(echo "$line" | cut -d'|' -f2)
  type=$(echo "$line" | cut -d'|' -f3)

  if [[ "$type" == "static" || "$type" == "oauth" ]]; then
    value=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$name" -w 2>/dev/null)
    if [[ -n "$value" ]]; then
      export "$env_var=$value"
      ((loaded++))
    else
      ((failed++))
    fi
  elif [[ "$type" == "file" ]]; then
    # For file-type secrets, set the path env var to the local credentials dir
    filename=$(basename "$(echo "$line" | cut -d'|' -f4)")
    if [[ -n "$filename" && -f "$CREDS_DIR/$filename" ]]; then
      export "$env_var=$CREDS_DIR/$filename"
      ((loaded++))
    fi
  fi
done < <(
  # Use node to parse JSON and filter by group — avoids jq dependency
  node -e "
    const m = require('$MANIFEST');
    for (const s of m.secrets) {
      if (s.groups && s.groups.includes('$GROUP')) {
        const fp = s.file_path || '';
        console.log(s.name + '|' + s.env_var + '|' + s.type + '|' + fp);
      }
    }
  " 2>/dev/null
)

echo "[load-secrets] group=$GROUP loaded=$loaded failed=$failed" >&2
