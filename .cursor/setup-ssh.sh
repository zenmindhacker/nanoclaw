#!/usr/bin/env bash
# Materialize SSH credentials from Cursor Cloud Agent Runtime Secrets.
# Requires SSH_PRIVATE_KEY (Runtime Secret). Optional: SSH_KNOWN_HOSTS.
set -euo pipefail

if [[ -z "${SSH_PRIVATE_KEY:-}" ]]; then
  echo "setup-ssh: SSH_PRIVATE_KEY not set — skipping (add as Runtime Secret in Cloud Agents dashboard)"
  exit 0
fi

mkdir -p ~/.ssh
chmod 700 ~/.ssh
umask 077

# Cursor Runtime Secrets may be multiline or use literal \n escapes.
if [[ "$SSH_PRIVATE_KEY" == *'\\n'* ]]; then
  printf '%b' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
else
  printf '%s' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
fi
# OpenSSH expects a trailing newline.
if [[ -s ~/.ssh/id_ed25519 ]] && [[ $(tail -c1 ~/.ssh/id_ed25519 | wc -l) -eq 0 ]]; then
  echo >> ~/.ssh/id_ed25519
fi
chmod 600 ~/.ssh/id_ed25519

if [[ ! -f ~/.ssh/config ]] || ! grep -q '^Host cleo$' ~/.ssh/config 2>/dev/null; then
  cat >> ~/.ssh/config <<'EOF'

Host cleo
  HostName cleo-lc.cognitivetech.net
  User cian
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes

Host cleo-silas
  HostName cleo-lc.cognitivetech.net
  User christina
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
EOF
  chmod 600 ~/.ssh/config
fi

if [[ -n "${SSH_KNOWN_HOSTS:-}" ]]; then
  printf '%b\n' "$SSH_KNOWN_HOSTS" >> ~/.ssh/known_hosts
else
  if ! grep -q 'cleo-lc.cognitivetech.net' ~/.ssh/known_hosts 2>/dev/null; then
    ssh-keyscan -H cleo-lc.cognitivetech.net >> ~/.ssh/known_hosts 2>/dev/null || true
  fi
fi
chmod 600 ~/.ssh/known_hosts 2>/dev/null || true

echo "setup-ssh: configured ~/.ssh for cleo / cleo-silas"
