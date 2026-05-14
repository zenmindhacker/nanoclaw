---
name: attio
description: Query and manage Attio CRM data (people, companies, deals). Uses attio-wrapper.sh which auto-loads credentials from ~/.openclaw/credentials/attio
---

# attio

Wrapper around the `attio` CLI for Attio CRM operations. Uses a wrapper script that auto-loads the API key.

## Setup

- Token stored in: `~/.openclaw/credentials/attio`
- CLI: Use `~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh` (NOT bare `attio`)
- The wrapper automatically loads the API key from credentials

## IM/WhatsApp/SMS/Signal Tracking (Simplified)

Use system fields + 2 custom fields:

| Field | Type | Description |
|-------|------|-------------|
| **phone_numbers** | phone-number (system) | For WA/Signal/SMS numbers |
| **last_im_date** | timestamp | Date/time of last message received |
| **last_whatsapp_message** | text | Last message content (any IM channel) |

### Update Command

```bash
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh records update people <record-id> --values '{"last_im_date": "2026-01-12T16:22:15", "last_whatsapp_message": "Message text here"}'
```

Note: Phone numbers should be added/updated via the Attio UI or use the system field format.

## Commands

**Important:** Use the wrapper script for all commands:
```bash
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh <command>
```

### People

```bash
# List people (limit 10)
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh people list --limit 10

# Search people by name
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh people list --search "John"

# Get person details
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh people get <record-id>

# Update a person with new message data
# Note: Use the attio CLI to update records
```

### Companies

```bash
# List companies
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh companies list --limit 10

# Search companies
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh companies list --search "Acme"

# Get company details
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh companies get <record-id>
```

### Deals

```bash
# List deals
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh deals list --limit 10
```

### Other

```bash
# Whoami (check auth)
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh whoami

# Force JSON output
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh --json <command>
```

## Usage

Call via exec tool with the wrapper script. The API key is automatically read from credentials.

## Updating IM Message Fields

For WhatsApp/SMS/Signal/Instagram messages, update these fields:

```bash
# Get person ID
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh people list --search "Name" | jq '.[0].id.record_id'

# Update timestamp + message
~/.openclaw/workspace/skills/attio/scripts/attio-wrapper.sh records update people <record-id> --values '{"last_im_date": "2026-01-12T16:22:15", "last_whatsapp_message": "Message content here"}'
```
