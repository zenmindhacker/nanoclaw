import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { getDb } from '../../../src/db/connection.js';
import { findSessionForAgent } from '../../../src/db/sessions.js';
import { heartbeatPath, outboundDbPath, writeSessionMessage } from '../../../src/session-manager.js';
import { UPGRADE_SLACK_REPLY_TOKEN } from '../manifest.js';
import type { RunContext } from '../types.js';
import { timedCheck } from '../report.js';
import type { CheckResult } from '../types.js';

function countOutboundChat(agentGroupId: string, sessionId: string): number {
  const dbPath = outboundDbPath(agentGroupId, sessionId);
  if (!fs.existsSync(dbPath)) return 0;
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT COUNT(*) AS n FROM messages_out WHERE kind = 'chat'").get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function resolveSlackWiring(agentGroupId: string): {
  messagingGroupId: string;
  platformId: string;
  threadId: string;
} | null {
  const row = getDb()
    .prepare(
      `SELECT mg.id AS messaging_group_id, mg.platform_id
         FROM messaging_group_agents mga
         JOIN messaging_groups mg ON mg.id = mga.messaging_group_id
        WHERE mga.agent_group_id = ?
          AND mg.channel_type = 'slack'
        LIMIT 1`,
    )
    .get(agentGroupId) as { messaging_group_id: string; platform_id: string } | undefined;
  if (!row) return null;

  const dmPlatform = row.platform_id.startsWith('slack:') ? row.platform_id : `slack:${row.platform_id}`;
  const threadTs = `${Date.now()}.000001`;
  const threadId = `${dmPlatform}:${threadTs}`;
  return { messagingGroupId: row.messaging_group_id, platformId: dmPlatform, threadId };
}

export async function runSlackWiringCheck(ctx: RunContext): Promise<CheckResult> {
  return timedCheck('slack.wiring', 1, async () => {
    const wiring = resolveSlackWiring(ctx.agentGroupId);
    if (!wiring) {
      return { status: 'skip', message: 'No Slack messaging group wired to primary agent' };
    }
    return { status: 'pass', message: wiring.platformId };
  });
}

export async function runSlackHistorySyncCheck(ctx: RunContext): Promise<CheckResult> {
  return timedCheck('slack.history-sync', 1, async () => {
    const modPath = path.join(process.cwd(), 'src/extensions/slack/history-sync.ts');
    if (!fs.existsSync(modPath)) {
      return { status: 'fail', message: 'history-sync extension missing' };
    }
    const src = fs.readFileSync(modPath, 'utf8');
    if (!src.includes('application/x-www-form-urlencoded')) {
      return {
        status: 'fail',
        message: 'history-sync must use form-urlencoded bodies for Slack Web API',
      };
    }

    const hooksPath = path.join(process.cwd(), 'src/extensions/slack/history-sync-hooks.ts');
    if (!fs.existsSync(hooksPath)) {
      return { status: 'fail', message: 'history-sync-hooks extension missing' };
    }
    const hooksSrc = fs.readFileSync(hooksPath, 'utf8');
    if (!hooksSrc.includes('registerInboundPreRouteHook')) {
      return { status: 'fail', message: 'history-sync-hooks must register inbound pre-route hook' };
    }

    const { registerInboundPreRouteHook } = await import('../../../src/router.js');
    if (typeof registerInboundPreRouteHook !== 'function') {
      return { status: 'fail', message: 'registerInboundPreRouteHook not exported' };
    }
    return { status: 'pass', message: 'Slack history sync extension present' };
  });
}

export async function runSlackSearchHistoryMcpCheck(_ctx: RunContext): Promise<CheckResult> {
  return timedCheck('slack.search-history-mcp', 1, async () => {
    const mcpPath = path.join(
      process.cwd(),
      'container/agent-runner/src/extensions/slack/search-history.ts',
    );
    if (!fs.existsSync(mcpPath)) {
      return { status: 'fail', message: 'search_slack_history MCP tool missing' };
    }
    const src = fs.readFileSync(mcpPath, 'utf8');
    if (!src.includes("name: 'search_slack_history'")) {
      return { status: 'fail', message: 'search_slack_history tool not registered' };
    }
    const instructionsPath = path.join(
      process.cwd(),
      'container/agent-runner/src/extensions/slack/search-history.instructions.md',
    );
    if (!fs.existsSync(instructionsPath)) {
      return { status: 'fail', message: 'search-history.instructions.md missing' };
    }
    return { status: 'pass', message: 'search_slack_history MCP present' };
  });
}

export async function runSlackSyntheticCheck(ctx: RunContext): Promise<CheckResult> {
  return timedCheck('slack.synthetic', 2, async () => {
    const wiring = resolveSlackWiring(ctx.agentGroupId);
    if (!wiring) {
      return { status: 'skip', message: 'No Slack wiring — synthetic inject skipped' };
    }

    const session = findSessionForAgent(ctx.agentGroupId, wiring.messagingGroupId, null);
    if (!session) {
      return {
        status: 'skip',
        message: 'No active session for Slack messaging group — send a Slack message first or wait for spawn',
      };
    }

    const before = countOutboundChat(ctx.agentGroupId, session.id);
    const msgId = `upgrade-slack-${Date.now()}`;

    const chatSdkContent = JSON.stringify({
      text: `Post-upgrade harness: reply with exactly ${UPGRADE_SLACK_REPLY_TOKEN} and nothing else.`,
      sender: 'UpgradeHarness',
      senderId: 'U_UPGRADE_TEST',
      slackRecipientUserId: 'U_UPGRADE_TEST',
      slackRecipientTeamId: 'T_UPGRADE_TEST',
      slackStreamThreadTs: wiring.threadId.split(':').pop(),
      isGroup: false,
      isMention: true,
    });

    writeSessionMessage(ctx.agentGroupId, session.id, {
      id: msgId,
      kind: 'chat-sdk',
      timestamp: new Date().toISOString(),
      platformId: wiring.platformId,
      channelType: 'slack',
      threadId: wiring.threadId,
      content: chatSdkContent,
      trigger: 1,
    });

    const hb = heartbeatPath(ctx.agentGroupId, session.id);
    fs.mkdirSync(path.dirname(hb), { recursive: true });
    fs.closeSync(fs.openSync(hb, 'a'));
    const now = new Date();
    fs.utimesSync(hb, now, now);

    const timeoutMs = 180_000;
    const start = Date.now();
    let found = false;
    let lastText = '';

    while (Date.now() - start < timeoutMs) {
      const after = countOutboundChat(ctx.agentGroupId, session.id);
      if (after > before) {
        const dbPath = outboundDbPath(ctx.agentGroupId, session.id);
        const db = new Database(dbPath, { readonly: true });
        try {
          const rows = db
            .prepare("SELECT content FROM messages_out WHERE kind = 'chat' ORDER BY seq DESC LIMIT 5")
            .all() as Array<{ content: string }>;
          for (const row of rows) {
            try {
              const parsed = JSON.parse(row.content) as { text?: string };
              lastText = parsed.text ?? row.content;
              if (lastText.includes(UPGRADE_SLACK_REPLY_TOKEN)) {
                found = true;
                break;
              }
            } catch {
              lastText = row.content;
            }
          }
        } finally {
          db.close();
        }
        if (found) break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (found) {
      return { status: 'pass', message: 'Agent wrote expected token to outbound.db' };
    }

    const after = countOutboundChat(ctx.agentGroupId, session.id);
    if (after > before) {
      return {
        status: 'warn',
        message: 'New outbound chat row but token mismatch',
        detail: lastText.slice(0, 300),
      };
    }

    return {
      status: 'fail',
      message: 'No new outbound chat message within timeout',
      detail: `waited ${timeoutMs / 1000}s; outbound before=${before} after=${after}`,
    };
  });
}

export async function runSlackSyntheticChecks(ctx: RunContext, tiers: Set<1 | 2>): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  if (tiers.has(1)) {
    checks.push(await runSlackWiringCheck(ctx));
    checks.push(await runSlackHistorySyncCheck(ctx));
    checks.push(await runSlackSearchHistoryMcpCheck(ctx));
  }
  if (tiers.has(2)) checks.push(await runSlackSyntheticCheck(ctx));
  return checks;
}
