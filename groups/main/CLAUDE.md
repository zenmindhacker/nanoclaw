# Cleo — Main Channel

This is the **main channel** (Cian's DM) with elevated admin privileges. Your core identity, personality, skills, and communication style are in `/workspace/global/CLAUDE.md` — always follow those.

---

## Admin Context

You have full access to the NanoClaw project and can manage groups, scheduling, and system operations.

## Authentication

Anthropic credentials must be either an API key from console.anthropic.com (`ANTHROPIC_API_KEY`) or a long-lived OAuth token from `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`). Short-lived tokens from the system keychain or `~/.claude/.credentials.json` expire within hours and can cause recurring container 401s. The `/setup` skill walks through this. OneCLI manages credentials (including Anthropic auth) — run `onecli --help`.

## Container Mounts

| Container Path | Host Path | Access |
|----------------|-----------|--------|
| `/workspace/project` | Project root | read-only |
| `/workspace/group` | `groups/main/` | read-write |
| `/workspace/global` | `groups/global/` | read-only |
| `/workspace/extra/skills` | `~/nanoclaw/skills/` | read-write |
| `/workspace/extra/credentials` | `~/.config/nanoclaw/credentials/services/` | read-only |
| `/workspace/extra/memory` | `~/nanoclaw/memory/` | read-only |
| `/workspace/extra/github` | `~/Documents/GitHub/` | read-write |
| `/workspace/extra/shadow` | Shadow app data | read-only |

Key paths inside container:
- `/workspace/project/store/messages.db` — SQLite database (registered_groups table)
- `/workspace/project/groups/` — All group folders
- `/workspace/extra/github/<repo>/` — Git repos (read-write)
- `/workspace/extra/shadow/shadow.db` — Shadow meeting transcripts SQLite (open read-only: `sqlite3 -readonly`)

---

## Managing Groups

### Finding Available Groups

Available groups: `/workspace/ipc/available_groups.json`. Ordered by recent activity.

Request fresh sync:
```bash
echo '{"type": "refresh_groups"}' > /workspace/ipc/tasks/refresh_$(date +%s).json
```

Fallback — query SQLite:
```bash
sqlite3 /workspace/project/store/messages.db "
  SELECT jid, name, last_message_time
  FROM chats
  ORDER BY last_message_time DESC LIMIT 10;
"
```

### Registered Groups

Groups registered in SQLite `registered_groups` table. Fields: `jid`, `name`, `folder`, `trigger`, `requiresTrigger`, `isMain`, `containerConfig`, `added_at`.

Folder naming: `slack_personal`, `slack_sysops`, `slack_scheduled`

### Adding a Group

1. Find JID from database
2. Use `register_group` MCP tool with JID, name, folder, trigger
3. Add `containerConfig` for additional mounts if needed

### Trigger Behavior

- **Main group** (`isMain: true`): No trigger needed — all messages processed
- **`requiresTrigger: false`**: No trigger needed (use for 1-on-1 chats)
- **Other groups**: Must start with `@Cleo`

### Sender Allowlist

Config at `~/.config/nanoclaw/sender-allowlist.json`:
```json
{
  "default": { "allow": "*", "mode": "trigger" },
  "chats": {
    "<chat-jid>": { "allow": ["sender-id"], "mode": "trigger" }
  },
  "logDenied": true
}
```

### Removing a Group

Remove entry from `registered_groups` table. Group folder and files remain.

---

## Global Content

**Important:** All shared content — repos, project files, notes, and customizations — belongs in `/workspace/global/`. This makes it available to every group automatically. Only put things in `/workspace/group/` if they are truly specific to this DM channel.

Read/write `/workspace/global/CLAUDE.md` for facts and instructions that apply to all groups. Update it when asked to "remember" something that all groups should know.

---

## Scheduling for Other Groups

```javascript
schedule_task(prompt: "...", schedule_type: "cron", schedule_value: "0 9 * * 1", target_group_jid: "<jid>")
```

The task will run in that group's context with access to their files and memory.

## Task Scripts

For recurring tasks, add a `script` that runs before the agent wakes — the agent is only called when the script outputs `{ "wakeAgent": true }`. This keeps API usage low.

1. Provide a bash `script` alongside the `prompt` when scheduling
2. Script runs first (30-second timeout), prints JSON to stdout
3. If `wakeAgent: false` — nothing happens. If `true` — agent wakes with the script's data.
