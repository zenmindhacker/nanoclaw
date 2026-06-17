/**
 * Fork extensions barrel — Cleo/Silas-specific agent-runner code.
 *
 * Upstream (nanocoai/nanoclaw) never edits container/agent-runner/src/extensions/**.
 * Import this from mcp-tools/index.ts for side-effect tool registration.
 *
 * See .nanoclaw/migrations/extensions.md for the full rationale.
 */

// Slack Thinking Steps MCP tool (report_stream_progress).
import './slack/stream-progress.js';
// Slack history search MCP tool (search_slack_history).
import './slack/search-history.js';
