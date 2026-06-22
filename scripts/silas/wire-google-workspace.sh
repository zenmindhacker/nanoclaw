#!/usr/bin/env bash
# Wire Silas Google Workspace: RO credentials mount, MCP servers, oauth registry snippets.
# Run on christina@cleo-lc after git pull + container image rebuild.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SILAS_GROUP="${SILAS_GROUP:-ag-1779225837260-j7xqo0}"
ALLOWLIST="${HOME}/.config/nanoclaw/mount-allowlist.json"
REGISTRY="${HOME}/.config/nanoclaw/credentials/services/oauth-registry.json"

echo "==> Phase 0: credentials mount read-only"
if [[ -f "$ALLOWLIST" ]]; then
  node - <<'NODE' "$ALLOWLIST"
const fs = require('fs');
const path = process.argv[1];
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
data.defaultMounts ??= [];
let mount = data.defaultMounts.find((m) => m.containerName === 'credentials');
if (!mount) {
  mount = {
    path: '~/.config/nanoclaw/credentials/services',
    containerName: 'credentials',
    allowReadWrite: false,
    description: 'Host OAuth token files (read-only)',
  };
  data.defaultMounts.push(mount);
} else {
  mount.allowReadWrite = false;
  mount.description ??= 'Host OAuth token files (read-only)';
}
fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
console.log('Updated credentials defaultMount allowReadWrite=false');
NODE
else
  echo "WARN: $ALLOWLIST not found — create defaultMounts credentials entry manually" >&2
fi

echo "==> Phase 2a: register calendar + gmail MCP on $SILAS_GROUP"
SHADOW_ENV='{"GOOGLE_OAUTH_CREDENTIALS":"/workspace/extra/credentials/shadow-google-oauth-client.json","GOOGLE_CALENDAR_MCP_TOKEN_PATH":"/workspace/extra/credentials/shadow-google-token.json"}'
GMAIL_ENV='{"GMAIL_OAUTH_PATH":"/workspace/extra/credentials/shadow-google-oauth-client.json","GMAIL_CREDENTIALS_PATH":"/workspace/extra/credentials/shadow-google-token.json"}'

pnpm run ncl groups config add-mcp-server \
  --id "$SILAS_GROUP" \
  --name calendar \
  --command google-calendar-mcp \
  --args '[]' \
  --env "$SHADOW_ENV" || true

pnpm run ncl groups config add-mcp-server \
  --id "$SILAS_GROUP" \
  --name gmail \
  --command gmail-mcp \
  --args '[]' \
  --env "$GMAIL_ENV" || true

echo "==> Phase 3: meridian-google registry entry (if client + token exist)"
if [[ -f "${HOME}/.config/nanoclaw/credentials/services/google-oauth-client.json" ]]; then
  node - <<'NODE' "$REGISTRY"
const fs = require('fs');
const path = process.argv[1];
if (!fs.existsSync(path)) {
  console.log('No oauth-registry.json — skip meridian entry');
  process.exit(0);
}
const reg = JSON.parse(fs.readFileSync(path, 'utf8'));
reg.tokens ??= [];
if (!reg.tokens.some((t) => t.id === 'meridian-google')) {
  reg.tokens.push({
    id: 'meridian-google',
    token_file: 'meridian-google-token.json',
    provider: 'google',
    token_url: 'https://oauth2.googleapis.com/token',
    client_file: 'google-oauth-client.json',
    auth_method: 'client_secret_post',
    account: 'christina@meridian-institute.org',
    description: 'Meridian Institute Google Workspace',
  });
  fs.writeFileSync(path, `${JSON.stringify(reg, null, 2)}\n`);
  console.log('Added meridian-google registry entry');
} else {
  console.log('meridian-google already in registry');
}
NODE
fi

echo "==> Flatten nested token if needed + refresh shadow-google"
node - <<'NODE'
const fs = require('fs');
const path = require('path');
const os = require('os');
const tokenPath = path.join(os.homedir(), '.config/nanoclaw/credentials/services/shadow-google-token.json');
if (!fs.existsSync(tokenPath)) process.exit(0);
const raw = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
if (raw.normal?.access_token) {
  const flat = { ...raw.normal };
  fs.writeFileSync(tokenPath, `${JSON.stringify(flat, null, 2)}\n`);
  console.log('Flattened shadow-google-token.json normal wrapper');
}
NODE

pnpm run ncl oauth-refresh-one --id shadow-google || true

echo "Done. Rebuild container if cli-tools.json changed: ./container/build.sh && systemctl --user restart nanoclaw"
