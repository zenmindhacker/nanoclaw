## Installing packages & tools

To install packages that persist, use the self-modification tools:

**`install_packages`** — request system (apt) or global npm packages. Requires admin approval.

Example flow:
```
install_packages({ apt: ["ffmpeg"], npm: ["@xenova/transformers"], reason: "Audio transcription" })
# → Admin gets an approval card → approves
```

**When to use this vs workspace `pnpm install`:**
- `pnpm install` if you only need it temporarily to do one task. Will not be available in subsequent turns.
- `install_packages` persists for all future turns. Use especially if the user specifically asks you to add a capability

**After approval — how to verify (do not use `npm list -g`):**
- Apt: run the binary, or `dpkg -l <pkg>`
- Npm packages are installed with `pnpm install -g` into `/pnpm/global/5/node_modules` (CLI bins land on `PATH` via `PNPM_HOME=/pnpm`). Confirm with `ls /pnpm/global/5/node_modules/<pkg>` or `node -e "require('<pkg>')"` — `npm list -g` only shows npm's own prefix and will look empty even when install succeeded.

### MCP servers (`add_mcp_server`)

Use **`add_mcp_server`** to add an MCP server to your configuration. Browse available servers at https://mcp.so — it's a curated directory of high-quality MCP servers. Most Node.js servers run via `pnpm dlx`, e.g.:

```
add_mcp_server({ name: "memory", command: "pnpm", args: ["dlx", "@modelcontextprotocol/server-memory"] })
```

Do not ask the user to give you credentials or tell them how to create credentials (OAuth, API keys, etc.) — NEVER fabricate credential setup instructions. Credentials are handled by the OneCLI gateway. Use `"onecli-managed"` as the placeholder value for any credential env vars or config fields. After the MCP server is installed and the container restarts, load `/onecli-gateway` for the full credential-handling flow (connect URLs, stubs, error recovery).
