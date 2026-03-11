---
name: substack-publisher
description: "Publish notes and posts to Substack via browser automation. Use when asked to post to Substack, publish a note, or push content to Substack."
---

# substack-publisher

Publishes notes to Substack via Browserless (cloud browser with stealth mode).

## Trigger phrases
- "publish a note to Substack"
- "post this to Substack"
- "publish on Substack"
- "send this to my Substack"

## Usage

```bash
node /Users/cian/.openclaw/workspace/skills/substack-publisher/scripts/browserless.mjs post-note "Your note text here"
```

Returns JSON:
- Success: `{"ok": true, "posted": true, "noteUrl": "https://...", "noteText": "..."}`
- Failure: `{"ok": false, "error": "...", "step": 3}`

The `step` field indicates where it failed (1-6) for debugging.

## If it fails

Use atomic commands to diagnose:

```bash
BL="/Users/cian/.openclaw/workspace/skills/substack-publisher/scripts/browserless.mjs"

node $BL login substack           # Test login separately
node $BL open "https://substack.com"
node $BL screenshot /tmp/debug.png  # See what's on screen
node $BL snapshot                   # Get element tree
node $BL eval "document.body.innerText.slice(0,500)"  # Check page content
node $BL close                      # Cleanup
```

## Error handling

| Output | Action |
|--------|--------|
| `{"ok": true, "posted": true}` | Done - return noteUrl to user |
| `{"needs2FA": true}` | Ask user for 2FA code (not automated) |
| `{"step": 3, ...}` | Login worked but Create button not found |
| `{"step": 6, ...}` | Post button disabled - text may not have entered |

## Credentials

Auto-loaded from `~/.openclaw/credentials/`:
- `substack-username`
- `substack-password`
- `browserless` (API token)
