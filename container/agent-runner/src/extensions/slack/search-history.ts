/**
 * Search exported Slack history JSON files in the agent group folder.
 */
import fs from 'fs';
import path from 'path';

import { registerTools } from '../../mcp-tools/server.js';
import type { McpToolDefinition } from '../../mcp-tools/types.js';

interface HistoryEntry {
  ts?: string;
  timestamp?: string;
  sender?: string;
  text?: string;
  threadId?: string | null;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

function loadJsonFile(filePath: string): HistoryEntry[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function searchEntries(entries: HistoryEntry[], query: string, limit: number): HistoryEntry[] {
  const q = query.toLowerCase();
  const matches = entries.filter((e) => (e.text ?? '').toLowerCase().includes(q));
  return matches.slice(-limit);
}

export const searchSlackHistory: McpToolDefinition = {
  tool: {
    name: 'search_slack_history',
    description:
      'Search Slack conversation history exported for this agent group. Checks slack_history.json (current thread/session) and slack_channel_history.json (cross-thread channel context). Use when the prompt lacks thread context or you need an earlier message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Case-insensitive substring to search for in message text',
        },
        limit: {
          type: 'number',
          description: 'Max matches to return (default 20)',
        },
      },
      required: ['query'],
    },
  },
  async handler(args) {
    const query = String(args.query ?? '').trim();
    if (!query) return err('query is required');

    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 20;
    const agentDir = '/workspace/agent';
    const threadHistory = loadJsonFile(path.join(agentDir, 'slack_history.json'));
    const channelHistory = loadJsonFile(path.join(agentDir, 'slack_channel_history.json'));
    const combined = [...threadHistory, ...channelHistory];

    const matches = searchEntries(combined, query, limit);
    if (matches.length === 0) {
      return ok(`No matches for "${query}" in slack_history.json or slack_channel_history.json`);
    }

    const lines = matches.map(
      (m) =>
        `[${m.timestamp ?? m.ts ?? '?'}] ${m.sender ?? 'unknown'}${m.threadId ? ` (${m.threadId})` : ''}: ${m.text}`,
    );
    return ok(lines.join('\n'));
  },
};

registerTools([searchSlackHistory]);
