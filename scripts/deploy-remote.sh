#!/usr/bin/env bash
# Deploy nanoclaw on cleo-lc and run post-upgrade smoke tests.
#
# Prerequisites:
#   - SSH configured (.cursor/setup-ssh.sh via Cloud Agent start, or local ~/.ssh/config)
#   - Host aliases: cleo (cian), cleo-silas (christina)
#
# Usage:
#   scripts/deploy-remote.sh              # cleo, tier 1,2
#   scripts/deploy-remote.sh silas        # silas, tier 1,2
#   scripts/deploy-remote.sh cleo 1       # cleo, tier 1 only
#   scripts/deploy-remote.sh cleo 1,2 --no-restart   # skip systemctl restart
set -euo pipefail

AGENT="${1:-cleo}"
TIER="${2:-1,2}"
NO_RESTART=false

for arg in "$@"; do
  if [[ "$arg" == "--no-restart" ]]; then
    NO_RESTART=true
  fi
done

case "$AGENT" in
  cleo) HOST=cleo ;;
  silas) HOST=cleo-silas ;;
  *)
    echo "Unknown agent: $AGENT (expected cleo or silas)" >&2
    exit 2
    ;;
esac

REMOTE_DIR="${NANOCLAW_REMOTE_DIR:-~/nanoclaw}"

echo "==> Deploy $AGENT on $HOST ($REMOTE_DIR)"

ssh "$HOST" bash -s -- "$REMOTE_DIR" "$NO_RESTART" <<'REMOTE'
set -euo pipefail
DIR="${1/#\~/$HOME}"
NO_RESTART="$2"
cd "$DIR"
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run build
if [[ "$NO_RESTART" != "true" ]]; then
  systemctl --user restart nanoclaw
fi
REMOTE

echo "==> Post-upgrade smoke (tier $TIER)"
ssh "$HOST" "cd $REMOTE_DIR && pnpm run post-upgrade -- --agent $AGENT --tier $TIER --json-out /tmp/upgrade-report.json && cat /tmp/upgrade-report.json"
