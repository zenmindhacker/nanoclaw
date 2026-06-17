import Database from 'better-sqlite3';
import fs from 'fs';

import { getMessagingGroupByPlatform } from '../../../src/db/messaging-groups.js';
import { findSessionForAgent } from '../../../src/db/sessions.js';
import { outboundDbPath } from '../../../src/session-manager.js';
import type { Session } from '../../../src/types.js';
import { replyContainsFixture, type MemoryFixture } from '../fixtures/memory-fixtures.js';
import type { RunContext } from '../types.js';
import { findRunningContainer } from './container.js';

export function resolveCliSession(ctx: RunContext): Session | null {
  const cliMg = getMessagingGroupByPlatform('cli', 'local');
  if (!cliMg) return null;
  return findSessionForAgent(ctx.agentGroupId, cliMg.id, null) ?? null;
}

export function countOutboundChat(agentGroupId: string, sessionId: string): number {
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

function parseOutboundText(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text ?? content;
  } catch {
    return content;
  }
}

/** Collect recent CLI outbound bodies (newest first). */
export function recentOutboundTexts(
  agentGroupId: string,
  sessionId: string,
  limit = 15,
): string[] {
  const dbPath = outboundDbPath(agentGroupId, sessionId);
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT content FROM messages_out
         WHERE kind = 'chat' AND channel_type = 'cli'
         ORDER BY seq DESC LIMIT ?`,
      )
      .all(limit) as Array<{ content: string }>;
    return rows.map((r) => parseOutboundText(r.content));
  } finally {
    db.close();
  }
}

export function findFixtureInOutbound(
  agentGroupId: string,
  sessionId: string,
  fixture: MemoryFixture,
  minCount: number,
): string | null {
  if (countOutboundChat(agentGroupId, sessionId) <= minCount) return null;
  for (const text of recentOutboundTexts(agentGroupId, sessionId)) {
    if (replyContainsFixture(text, fixture, true)) return text;
  }
  return null;
}

export async function pollOutboundForFixture(
  agentGroupId: string,
  sessionId: string,
  fixture: MemoryFixture,
  minCount: number,
  maxMs: number,
): Promise<string | null> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const hit = findFixtureInOutbound(agentGroupId, sessionId, fixture, minCount);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/** Wait until no session container is running for this agent group folder. */
export async function waitForGroupContainersIdle(folder: string, maxMs = 180_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (!findRunningContainer(folder)) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
