---
name: create-skill
description: Create, update, or propose new NanoClaw skills. Use whenever you need to build a reusable integration, automate a recurring workflow, wrap an API, or package a script for long-term use. Also use when refactoring something from a thread-local hack into a proper durable skill. Triggers on "make this a skill", "create a skill for X", "this should be a permanent tool", or when you notice yourself npm-installing something ad-hoc.
allowed-tools: Bash
---

# Create / Update Skill

NanoClaw skills live in two places, both in the repo at `~/nanoclaw/`:

| Layer | Path | Purpose | Deployed via |
|-------|------|---------|-------------|
| **Discovery** | `container/skills/<name>/SKILL.md` | Agent sees this — triggers, docs, usage | Synced to `.claude/skills/` at container start |
| **Runtime** | `skills/<name>/` | Actual code, `package.json`, scripts | Mounted at `/workspace/extra/skills/<name>/` |

Both are needed. Discovery tells you the skill exists and how to use it. Runtime is the code you execute.

## When to Create a Skill

Create a skill when:
- You're wrapping an external API (AnyList, Todoist, Attio, etc.)
- You have a script that runs repeatedly (daily chores, transcript sync)
- You `npm install` something to solve a problem — that's a sign it should be a skill
- A workflow spans multiple threads and needs to be available everywhere
- The user asks you to "make this permanent" or "turn this into a tool"

**Never** just `npm install` in a thread dir and call it done. Thread dirs are scratch space.

## Creating a New Skill

### Step 1: Create the runtime code

```bash
SKILL_NAME="my-skill"
mkdir -p /workspace/extra/skills/$SKILL_NAME/scripts
cd /workspace/extra/skills/$SKILL_NAME
```

Create `package.json`:
```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {}
}
```

Write your library code (e.g., `my-skill.mjs`) and optionally a CLI wrapper (`cli.mjs`).

**CLI pattern** (recommended for skills the agent calls via Bash):
```javascript
#!/usr/bin/env node
// cli.mjs — thin wrapper around the library
import { MyClient } from "./my-skill.mjs";

const commands = {
  async "list"(client) { /* ... */ },
  async "add"(client, ...args) { /* ... */ },
  async help() { console.log("Commands:", Object.keys(commands).join(", ")); },
};

const [cmd, ...args] = process.argv.slice(2);
const fn = commands[cmd] ?? commands.help;
const client = new MyClient();
try {
  await client.init();
  await fn(client, ...args);
} finally {
  client.teardown();
}
```

### Step 2: Create the SKILL.md (discovery)

Write to `/workspace/extra/skills/$SKILL_NAME/SKILL.md` (this gets deployed to `container/skills/` later):

```markdown
---
name: my-skill
description: <What it does. When to use it. Be specific and slightly pushy — include trigger phrases so Claude activates the skill reliably.>
allowed-tools: Bash
---

# My Skill

<Brief description>

## First-Run Setup

\`\`\`bash
cd /workspace/extra/skills/my-skill
[ ! -d node_modules ] && npm install --silent
\`\`\`

## CLI Commands

| Command | Description |
|---------|-------------|
| `list` | ... |
| `add <args>` | ... |

## Library Usage

\`\`\`javascript
import { MyClient } from "/workspace/extra/skills/my-skill/my-skill.mjs";
\`\`\`

## Credentials

<Where creds come from — env vars, credential files, etc.>
```

### Step 3: Test it

```bash
cd /workspace/extra/skills/$SKILL_NAME
npm install
node cli.mjs help
node cli.mjs list   # or whatever the smoke test is
```

### Step 4: Tell the admin

After creating and testing a skill, notify the admin (Cian) via the main channel or #sysops:

> New skill `<name>` created at `/workspace/extra/skills/<name>/`.
> It does: <one-line description>.
> Needs deployment: copy SKILL.md to `container/skills/<name>/` and push to repo.

The admin will:
1. Copy SKILL.md to `container/skills/<name>/SKILL.md` in the repo
2. `git add`, commit, push
3. Pull + restart on the server

Until deployed, the skill works via direct Bash calls but won't auto-trigger via the `/skill` system.

## Updating an Existing Skill

Edit files directly in `/workspace/extra/skills/<name>/`:
```bash
cd /workspace/extra/skills/<name>
# Edit code...
node cli.mjs <test-command>   # verify
```

For SKILL.md changes (new commands, updated docs), also update the copy in `container/skills/<name>/SKILL.md`. Both must stay in sync.

After updating, tell the admin so they can commit + deploy.

## Skill Architecture Patterns

### API wrapper skill (most common)
```
skills/my-api/
├── package.json        # deps: the API client, dotenv, form-data
├── my-api.mjs          # client library (login, CRUD, helpers)
├── cli.mjs             # CLI commands for Bash invocation
└── scripts/
    └── daily-job.mjs   # scheduled automation (optional)
```

### Script-only skill (no library)
```
skills/my-script/
├── package.json
└── scripts/
    └── run.sh          # standalone script
```

### Gate script skill (cron + agent wake)
```
skills/my-sync/
├── package.json
├── scripts/
│   ├── my-sync.ts      # main logic
│   └── run-sync.sh     # container entry point
└── SKILL.md
```

## Credential Handling

- Credentials come from env vars injected at container start
- Registered in the host's `.env` or secrets manifest
- **Never hardcode credentials** in skill code
- Use `process.env.MY_API_KEY` pattern
- If a new credential is needed, tell the admin to add it to `.env`

## Common Pitfalls

- **Don't npm install in thread dirs.** Use `/workspace/extra/skills/<name>/` — it persists.
- **Don't forget the SKILL.md in container/skills/.** Without it, the skill won't auto-trigger.
- **Don't use absolute paths to thread dirs** like `/workspace/group/`. Use `/workspace/extra/skills/` for skill code.
- **Do include first-run setup** in the SKILL.md — `npm install` needs to happen once per container image rebuild.
- **Do test before announcing.** Run the CLI commands and verify output.
