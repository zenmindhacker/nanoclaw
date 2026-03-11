# IM Management Skill

Unified instant message management across WhatsApp, Signal, Instagram, Facebook, and LinkedIn.

## Quick Reference

**Design Doc:** `~/.openclaw/workspace/docs/attio-im-list-redesign.md`

**Credentials:**
- Attio: `~/.openclaw/credentials/attio`
- Beeper: `~/.openclaw/credentials/beeper`

**IM List ID:** `569a3e1a-84e1-4fd0-9aab-39f7f0a64483`

---

## Heartbeat Tasks

### Daily Sync (7:30am)

**Purpose:** Pull last 24h messages from all platforms, upsert to Attio, update statuses.

**Steps:**
1. Run `scripts/sync-messages.sh` → get messages from WhatsApp (wacli) + Beeper (Signal/Instagram/FB/LinkedIn)
2. For each message, find or create Attio contact:
   - **Phone exact match** → auto-link
   - **Name >95% match** → auto-link
   - **Name 85-95% match** → queue for review
   - **No match** → auto-create new contact
3. Update Attio fields: `last_im_date`, `last_whatsapp_message`, `last_message_from_me`, `preferred_channel`
4. For new contacts added to IM List, set `relationship_tier` = "Regular Contacts" (default)
5. Run `scripts/update-statuses.sh` → recalculate status for all contacts based on tier cadence
6. Report summary: `{created: N, linked: N, pending_review: N, status_changes: N}`

### Status Calculation (Agent-Driven)

**OpenClaw calculates status** based on `last_im_date` + `relationship_tier`:

| Status | Threshold |
|--------|-----------|
| Active | < 75% of tier cadence |
| Check Soon | 75-100% of cadence |
| Overdue | 100-150% of cadence |
| Reconnect | > 150% of cadence |
| On Pause | Manual only (never auto-set) |

Special case: If `last_message_from_me = false` → always "Overdue" (they're waiting on you)

### Daily Digest (8:00am)

**Purpose:** Send Cian his daily relationship check-in via Slack DM.

**Steps:**
1. Run `scripts/collect-digest-data.sh` → query Attio IM List
2. Build digest with priorities:
   - **Waiting on me** (they messaged, I haven't replied) - HIGHEST
   - **Overdue** (past expected cadence for tier)
   - **Check soon** (approaching cadence)
3. Include any pending review items from sync/audit
4. Send to Slack DM (Cian)
5. Stay available for follow-up commands:
   - `1`, `2`, etc. → Generate message suggestion for that contact
   - `send` → Send the suggested message
   - `merge N` → Merge duplicate pair N
   - `skip N` → Dismiss review item N

### Weekly Audit (Sunday 9:00am)

**Purpose:** Clean up data quality issues.

**Steps:**
1. Run `scripts/weekly-audit.sh` → find duplicates, missing fields, stale records
2. Process duplicates:
   - **Same phone** → auto-merge
   - **Name similarity only** → queue for review
3. Flag missing fields (never auto-fill `relationship_tier`)
4. Flag stale records (6+ months, not Archived)
5. Include audit summary in digest or send separate report

---

## Agent Autonomy Rules

| Decision | Auto | Ask Cian |
|----------|------|----------|
| Match contact by phone | ✅ | — |
| Match contact by name (>95%) | ✅ | 85-95% |
| Merge duplicates (same phone) | ✅ | Name-only |
| Create new contact (no matches) | ✅ | Partial matches |
| Update fields from sync | ✅ | — |
| **Send message** | ❌ | ✅ Always |
| **Assign relationship tier** | ❌ | ✅ Always |
| **Archive contacts** | ❌ | ✅ Always |

---

## Relationship Tiers & Cadence

| Tier | Expected Cadence |
|------|------------------|
| Inner Circle | 7 days |
| Core Network | 30 days |
| Regular Contacts | 60 days |
| Occasional | 120 days |
| Archived | No expectation |

---

## Platform Identities

```python
MY_IDENTITIES = {
    "whatsapp": "+16726677729",
    "signal": "+16726677729", 
    "instagram": "@cianwhalley",
    "facebook": "710936256",
    "linkedin": "ACoAAAIF0RsBdOCCRmGx-sSPqbks8WxUN9_OxMQ"
}
```

## Beeper Account IDs

```python
BEEPER_ACCOUNTS = {
    "signal": "local-signal_ba_KFp3H3Ed5ZfTYPVAMNgx3VR5ZVs",
    "instagram": "local-instagram_ba_GT4LlnYbAfM1h-v8DFC4mCImsXQ",
    "facebook": "facebookgo",
    "linkedin": "linkedin"
}
```

---

## CLI Commands

### Attio

```bash
# List IM List entries
attio-wrapper.sh entries list 569a3e1a-84e1-4fd0-9aab-39f7f0a64483 --json

# Get person record
attio-wrapper.sh records get people <record-id> --json

# Update person after message
attio-wrapper.sh records update people <record-id> --values '{
  "last_im_date": "2026-02-23T10:00:00Z",
  "last_message_content": "Message preview",
  "last_message_from_me": true,
  "preferred_channel": "whatsapp"
}'

# Search by phone
attio-wrapper.sh records search people --query "+16725551234"

# Add to IM List
attio-wrapper.sh entries create 569a3e1a-84e1-4fd0-9aab-39f7f0a64483 \
  --record <person-record-id> --object people
```

### Beeper API

```bash
BEEPER_TOKEN=$(cat ~/.openclaw/credentials/beeper)

# List accounts
curl -H "Authorization: Bearer $BEEPER_TOKEN" http://localhost:23373/v1/accounts

# List chats
curl -H "Authorization: Bearer $BEEPER_TOKEN" "http://localhost:23373/v1/chats?limit=50"

# Get messages from chat
curl -H "Authorization: Bearer $BEEPER_TOKEN" \
  "http://localhost:23373/v1/chats/{chatID}/messages?limit=20"

# Send message
curl -X POST -H "Authorization: Bearer $BEEPER_TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:23373/v1/chats/{chatID}/messages" \
  -d '{"text": "Your message"}'
```

### WhatsApp (wacli)

```bash
# Get recent messages
wacli messages list --limit 50

# Get messages from specific contact
wacli messages list --jid "+16725551234@s.whatsapp.net" --limit 20

# Send message
wacli send "+16725551234" "Your message"
```

### Slack

```bash
# Send DM to Cian
slack-cli chat send --channel "@cian" --text "Your message"

# Send to #sysops for errors
slack-cli chat send --channel "#sysops" --text "🚨 Error message"
```

---

## Error Handling

All errors route to **#sysops** Slack channel.

```bash
slack-cli chat send --channel "#sysops" \
  --text "🚨 IM Management Error
Task: $TASK
Error: $ERROR_MESSAGE
Time: $(date)"
```

---

## Message Suggestion Prompts

When generating message suggestions, use tier-appropriate tone:

- **Inner Circle**: Deep, vulnerable, casual/intimate
- **Core Network**: Meaningful with specific references, warm
- **Regular Contacts**: Professional-friendly, concise
- **Occasional**: Light reconnection with clear reason

**Never use:**
- "hey what's up"
- "how are you"
- Generic greetings

**Always reference:**
- Recent conversation context
- Shared interests/topics
- Relationship-specific context from Attio notes
