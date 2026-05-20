---
name: credentials
description: Manage and debug credentials in v2. Covers OneCLI-injected API keys, host-managed OAuth token files, and agent-editable legacy credential files. Use when a service returns 401/403, a key is missing, or you need to store a new non-OAuth secret.
---

# Credential Management (v2)

NanoClaw uses **three credential lanes**. Pick the right one before adding or changing anything.

## The Three Lanes

| Lane | Where it lives | Who manages it | Used for |
|------|----------------|----------------|----------|
| **OneCLI** | Host vault; injected at HTTP request time via proxy | Admin / operator (`onecli` CLI or web UI) | API keys for proxied outbound HTTP from containers (`opencode.ai`, `api.anthropic.com`, etc.) |
| **Host OAuth files** | `~/.config/nanoclaw/credentials/services/` on host | Host refresher + operator re-auth | Google, Xero, and other OAuth refresh-token flows |
| **Agent-editable files** | `/workspace/extra/credentials/` in container | **You** (the agent) | Keys and tokens you discover or the user gives you that are **not** host-managed |

**Do not** put OAuth refresh tokens or host-managed secrets into agent-editable files unless the operator explicitly asks you to mirror something for a one-off script.

---

## OneCLI (proxied API keys)

Containers route API traffic through the OneCLI gateway. You **never** see raw vault values in env vars or chat.

### When to use OneCLI

- OpenCode Go (`opencode.ai`) — orchestrator and `opencode run` / delegate text workers
- Anthropic API (if configured)
- Any service the operator registered with a `hostPattern` in OneCLI

### When OneCLI is missing

If a call fails because a secret is not configured in OneCLI, tell the operator:

1. Open the OneCLI UI (usually `http://127.0.0.1:10254` on the host, or the link OneCLI returned in the error).
2. Create a **generic** or typed secret with the correct host pattern and header (e.g. `Authorization: Bearer {value}` for OpenCode Go).
3. Assign the secret to your agent (`onecli agents set-secrets` or **mode all**).

Do **not** ask the user to paste API keys into chat for OneCLI-managed hosts — use the vault UI.

### Check (operator-side)

You cannot list OneCLI secrets from inside the container. If unsure, ask the operator to run on the host:

```bash
onecli secrets list
onecli agents secrets --id <agent-id>
```

---

## Host OAuth (Google, Xero, …)

Long-lived OAuth lives in **token JSON files** on the host, refreshed automatically by the NanoClaw host process.

| File (examples) | Purpose |
|-------------------|---------|
| `google-gmail-token.json` | Gmail + related Google scopes |
| `ganttsy-google-token.json` | Ganttsy Google |
| `shadow-google-token.json` | Shadow calendar |
| `xero-tokens.json` | Xero accounting |
| `oauth-registry.json` | Index of token files + refresh endpoints (host only) |

Mounted read-only at `/workspace/extra/credentials/<filename>`.

### Agent rules

- **Read** these files when a skill expects them (invoice-generator, calendar, etc.).
- **Do not overwrite** host OAuth token files — the host refresher is the only writer.
- **Inspect / retry on host:** `ncl oauth-health`, `ncl oauth-refresh-now`, `ncl oauth-refresh-one --id <registry-id>` (requires CLI access; host mutates files).
- If refresh still fails (`invalid_grant`, missing refresh token), post to `#sysops` and tell the operator to re-auth on the host. Do not guess refresh tokens.

---

## Agent-editable legacy files

Use `/workspace/extra/credentials/` for secrets **you** own: new API keys the user gives you, per-integration tokens, or multimodal keys not in OneCLI.

### Layout

- **Flat file per secret** (common): `/workspace/extra/credentials/openrouter` — raw key, no extension (used for OpenRouter image/video only)
- **JSON registry** (optional): `/workspace/extra/credentials/credentials.json` — `{ "ENV_VAR_NAME": "value" }` for skills that read named env-style keys from files
- **Named token files**: e.g. `my-service-token.json`

Changes persist on the host mount. They take effect on the **next container spawn** (next message).

### Add or update a flat secret file

```bash
CRED_DIR="/workspace/extra/credentials"
mkdir -p "$CRED_DIR"
# Example: save a new API key (never echo the full value back to the user)
printf '%s' 'PASTE_KEY_HERE' > "$CRED_DIR/my-service-api-key"
chmod 600 "$CRED_DIR/my-service-api-key" 2>/dev/null || true
echo "Saved my-service-api-key (masked)"
```

### Add or update credentials.json

```bash
CRED_FILE="/workspace/extra/credentials/credentials.json"
node -e "
  const fs = require('fs');
  const path = '$CRED_FILE';
  const creds = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
  creds['EXAMPLE_API_KEY'] = process.argv[1];
  fs.mkdirSync(require('path').dirname(path), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(creds, null, 2));
  console.log('Updated keys:', Object.keys(creds).join(', '));
" 'YOUR_KEY_VALUE'
```

### Remove a secret

```bash
rm -f /workspace/extra/credentials/my-service-api-key
# or delete a key from credentials.json with node (same pattern as add)
```

### List what you can see (masked)

```bash
echo "=== Host-mounted credential files ==="
ls -la /workspace/extra/credentials/ 2>/dev/null || echo "(none)"

echo ""
echo "=== credentials.json keys ==="
CRED_FILE="/workspace/extra/credentials/credentials.json"
if [ -f "$CRED_FILE" ]; then
  node -e "
    const creds = JSON.parse(require('fs').readFileSync('$CRED_FILE', 'utf8'));
    for (const k of Object.keys(creds)) console.log(k + '=' + String(creds[k]).slice(0,4) + '***');
  "
else
  echo "(none)"
fi

echo ""
echo "=== Env vars (often empty in v2 — do not rely on raw API keys here) ==="
env | grep -E '_KEY=|_TOKEN=|_SECRET=' | sed 's/=.*/=***/' | sort || true
```

---

## OpenCode Go vs OpenRouter

| Use case | Lane |
|----------|------|
| **Orchestrator** (you) | OpenCode Go via OneCLI — `OPENCODE_MODEL=opencode-go/kimi-k2.6` |
| **Delegate text workers** | OpenCode Go via `delegate` + `opencode run` (same subscription) |
| **Voice notes** | ElevenLabs key in `/workspace/extra/credentials/elevenlabs` for the `voice-note` skill |
| **Images / video** | Legacy file `/workspace/extra/credentials/openrouter` (OpenRouter multimodal APIs only) |

Do **not** use OpenRouter for routine text delegation when OpenCode Go is configured — that duplicates the orchestrator model and wastes quota.

---

## When something is missing

1. **Proxied HTTP (401 from opencode.ai, etc.)** → OneCLI secret not assigned; operator fixes vault.
2. **Google/Xero skill errors** → host OAuth file expired; operator re-auths on host.
3. **Voice note errors** → check `/workspace/extra/credentials/elevenlabs`; if missing, ask operator to add the file on the host mount or give you the key to save there.
4. **Image/video errors** → check `/workspace/extra/credentials/openrouter`.
5. **New third-party API** → save under `/workspace/extra/credentials/` (agent-editable) unless operator prefers OneCLI for that host.

When the user provides a key in chat for a **non-OneCLI** service, save it immediately to the appropriate file under `/workspace/extra/credentials/`, confirm with a masked message, and note it applies on the next message.

---

## Security

- Never echo raw secrets in responses.
- Never put host OAuth or OneCLI vault values in `credentials.json` unless mirroring is explicitly requested.
- Prefer OneCLI for any API key that matches a registered `hostPattern` on the host.
