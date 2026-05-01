#!/usr/bin/env bash
# todoist.sh — wrapper for todoist.ts
# Usage: todoist.sh <command> [options]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec node --experimental-strip-types "$SCRIPT_DIR/todoist.ts" "$@"
