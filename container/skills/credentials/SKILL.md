---
name: credentials
description: Manage API keys and credentials. Use when you need to add, update, remove, or check credentials. Also reference when a service API returns 401/403 or a key is missing.
---

# Credential Management

You have full control over your credentials. API keys and tokens are stored as files on your persistent credential mount and injected as environment variables into every container you run in.

## Quick Reference

| Action | How |
|--------|-----|
| Check what's available | `env \| grep -E 'API_KEY\|TOKEN\|SECRET' \| sed 's/=.*/=***/'` |
| Check credential files | `cat /workspace/extra/credentials/credentials.json 2>/dev/null \| python3 -m json.tool` |
| Add/update a key | Write to `credentials.json` (see below) |
| Remove a key | Remove entry from `credentials.json` |
| Check file-based tokens | `ls /workspace/extra/credentials/` |

## How Credentials Work

Two sources, merged at container startup:

1. **Host-level** (`.env` + manifest) — set by the admin. You can see these as env vars but can't change them.
2. **Agent-managed** (`credentials.json`) — you control this. Add, update, or remove keys anytime. Changes take effect on your next container (next message you process).

Agent-managed credentials **override** host-level ones, so you can fix a broken key immediately.

## Adding or Updating a Credential

Read the current registry, update it, write it back:

```bash
# Read current credentials (or start fresh)
CRED_FILE="/workspace/extra/credentials/credentials.json"
if [ -f "$CRED_FILE" ]; then
  CREDS=$(cat "$CRED_FILE")
else
  CREDS='{}'
fi

# Add/update using node (handles JSON safely)
node -e "
  const creds = JSON.parse(process.argv[1]);
  creds['EXAMPLE_API_KEY'] = 'sk-new-key-value';
  const fs = require('fs');
  fs.writeFileSync('$CRED_FILE', JSON.stringify(creds, null, 2));
  console.log('Updated. Keys:', Object.keys(creds).join(', '));
" "$CREDS"
```

Replace `EXAMPLE_API_KEY` and the value with the actual key name and value.

## Removing a Credential

```bash
CRED_FILE="/workspace/extra/credentials/credentials.json"
node -e "
  const fs = require('fs');
  const creds = JSON.parse(fs.readFileSync('$CRED_FILE', 'utf-8'));
  delete creds['EXAMPLE_API_KEY'];
  fs.writeFileSync('$CRED_FILE', JSON.stringify(creds, null, 2));
  console.log('Removed. Remaining keys:', Object.keys(creds).join(', '));
"
```

## Listing All Credentials

Show both sources — env vars (host-managed) and file-based (agent-managed):

```bash
echo "=== Environment Variables (host-managed) ==="
env | grep -E '_KEY=|_TOKEN=|_SECRET=|_PASSWORD=' | sed 's/=.*/=***/' | sort

echo ""
echo "=== Agent-Managed (credentials.json) ==="
CRED_FILE="/workspace/extra/credentials/credentials.json"
if [ -f "$CRED_FILE" ]; then
  node -e "
    const creds = JSON.parse(require('fs').readFileSync('$CRED_FILE', 'utf-8'));
    for (const [k, v] of Object.entries(creds)) {
      console.log(k + '=' + v.slice(0, 4) + '***');
    }
  "
else
  echo "(none yet)"
fi

echo ""
echo "=== File-Based Tokens ==="
ls /workspace/extra/credentials/ 2>/dev/null | grep -v credentials.json || echo "(none)"
```

## When a Credential is Missing

1. **Check env first** — it may be named differently than expected
2. **Check credentials.json** — maybe it was set but under a different name
3. **If truly missing**, tell the user: "I need [SERVICE_NAME] credentials. You can give me the API key and I'll store it securely, or add it to `.env` on the host."
4. When the user provides a key in chat, **immediately store it** in `credentials.json` using the steps above. Confirm it's saved and tell them it'll be active on your next message.

## Important

- **Never echo raw credential values** in responses to the user. Use masked output (`sk-xxx***`).
- Credentials persist across restarts — `credentials.json` lives on the host filesystem.
- Changes take effect on the **next container spawn** (next message), not the current one.
- The `credentials.json` format is a flat JSON object: `{ "ENV_VAR_NAME": "value", ... }`
