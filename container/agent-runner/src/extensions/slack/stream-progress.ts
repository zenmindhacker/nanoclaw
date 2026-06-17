/**
 * Slack Thinking Steps — report observable work to the host stream without
 * sending a separate chat message.
 */
import { getSessionRouting } from '../../db/session-routing.js';
import { writeMessageOut } from '../../db/messages-out.js';
import { registerTools } from '../../mcp-tools/server.js';
import type { McpToolDefinition } from '../../mcp-tools/types.js';

function log(msg: string): void {
  console.error(`[mcp-tools] ${msg}`);
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const reportStreamProgress: McpToolDefinition = {
  tool: {
    name: 'report_stream_progress',
    description:
      'Report observable work on Slack (tool call, export, API step). Updates the live Thinking Steps timeline — not a separate chat message. Do not use for reasoning or chain-of-thought.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Short user-visible label, e.g. "Exporting Toggl dashboard PDF"',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'complete', 'error'],
          description: 'Task state. Use in_progress when starting, complete or error when done.',
        },
        taskId: {
          type: 'string',
          description:
            'Stable id for this step (reuse the same id when updating). Defaults to a slug from title.',
        },
        details: {
          type: 'string',
          description: 'Optional extra context shown while in progress',
        },
        output: {
          type: 'string',
          description: 'Optional result summary when status is complete or error',
        },
      },
      required: ['title', 'status'],
    },
  },
  async handler(args) {
    const title = (args.title as string)?.trim();
    const status = args.status as string;
    if (!title) return err('title is required');
    if (!['pending', 'in_progress', 'complete', 'error'].includes(status)) {
      return err('status must be pending, in_progress, complete, or error');
    }

    const routing = getSessionRouting();
    if (routing.channel_type !== 'slack') {
      return ok('Progress noted (non-Slack session — no live timeline)');
    }
    if (!routing.channel_type || !routing.platform_id) {
      return err('No session routing — cannot report stream progress');
    }

    const taskId =
      typeof args.taskId === 'string' && args.taskId.trim()
        ? args.taskId.trim()
        : title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 64);

    const content: Record<string, unknown> = {
      title,
      status,
      taskId,
    };
    if (typeof args.details === 'string' && args.details.trim()) {
      content.details = args.details.trim();
    }
    if (typeof args.output === 'string' && args.output.trim()) {
      content.output = args.output.trim();
    }

    writeMessageOut({
      id: generateId(),
      kind: 'stream_progress',
      platform_id: routing.platform_id,
      channel_type: routing.channel_type,
      thread_id: routing.thread_id,
      content: JSON.stringify(content),
    });

    log(`report_stream_progress: ${taskId} → ${status} — ${title}`);
    return ok(`Progress queued (${status}): ${title}`);
  },
};

registerTools([reportStreamProgress]);
