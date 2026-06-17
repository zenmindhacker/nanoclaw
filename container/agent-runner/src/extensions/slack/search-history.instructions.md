## Slack history search

When thread or channel context is missing from the prompt:

1. Read `/workspace/agent/slack_history.json` for messages synced into this session.
2. For group channels (#sysops etc.), also read `/workspace/agent/slack_channel_history.json` for sibling-thread context.
3. Or call MCP tool **`search_slack_history`** with a keyword from the user's question.

The host syncs Slack API history into those files and into silent context rows before you wake.
