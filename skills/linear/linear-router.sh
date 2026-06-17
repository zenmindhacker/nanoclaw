#!/usr/bin/env bash
# Back-compat wrapper — canonical script lives in scripts/
exec "$(dirname "$0")/scripts/linear-router.sh" "$@"
