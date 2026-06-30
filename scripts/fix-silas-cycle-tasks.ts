/**
 * One-time cleanup: cancel duplicate cycle briefing tasks and retire stale
 * dm-with-christina sessions on christina@cleo (Silas install).
 *
 * Usage:
 *   pnpm exec tsx scripts/fix-silas-cycle-tasks.ts --dry-run
 *   pnpm exec tsx scripts/fix-silas-cycle-tasks.ts
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { DATA_DIR } from '../src/config.js';
import { initDb, closeDb } from '../src/db/connection.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { cancelTask } from '../src/modules/scheduling/db.js';
import { openInboundDb } from '../src/session-manager.js';

const CANONICAL_SESSION = 'sess-1782170556889-ydslvi';
const CANONICAL_MG = 'mg-1779388264578-jk5zho';

/** Pending cycle tasks to cancel (confirmed duplicates). */
const CANCEL_TASKS: Array<{ sessionId: string; taskId: string }> = [
  { sessionId: 'sess-1779388264581-r94tdr', taskId: 'task-1782799306930-nwt2mk' },
  { sessionId: 'sess-1782773492657-a5054h', taskId: 'task-1782827533485-8vdtd3' },
];

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found');
    process.exit(1);
  }

  const db = initDb(v2DbPath);
  runMigrations(db);

  const ag = getAgentGroupByFolder('dm-with-christina');
  if (!ag) {
    console.error('dm-with-christina agent group not found');
    process.exit(1);
  }

  for (const { sessionId, taskId } of CANCEL_TASKS) {
    const inboundPath = path.join(DATA_DIR, 'v2-sessions', ag.id, sessionId, 'inbound.db');
    if (!fs.existsSync(inboundPath)) {
      console.log(`SKIP:cancel ${taskId} — no inbound.db for ${sessionId}`);
      continue;
    }
    const inboxDb = openInboundDb(ag.id, sessionId);
    try {
      const row = inboxDb
        .prepare("SELECT id, status FROM messages_in WHERE id = ? AND kind = 'task'")
        .get(taskId) as { id: string; status: string } | undefined;
      if (!row) {
        console.log(`SKIP:cancel ${taskId} — not found in ${sessionId}`);
        continue;
      }
      if (row.status === 'completed') {
        console.log(`SKIP:cancel ${taskId} — already completed`);
        continue;
      }
      if (dryRun) {
        console.log(`DRY:cancel ${taskId} on ${sessionId}`);
      } else {
        cancelTask(inboxDb, taskId);
        console.log(`OK:cancelled ${taskId} on ${sessionId}`);
      }
    } finally {
      inboxDb.close();
    }
  }

  const active = db
    .prepare(
      `SELECT id, messaging_group_id, thread_id, last_active
       FROM sessions
       WHERE agent_group_id = ? AND status = 'active'`,
    )
    .all(ag.id) as Array<{
    id: string;
    messaging_group_id: string | null;
    thread_id: string | null;
    last_active: string | null;
  }>;

  const keep = new Set<string>([CANONICAL_SESSION]);
  const recentOther = active
    .filter((s) => s.id !== CANONICAL_SESSION && s.messaging_group_id === CANONICAL_MG)
    .sort((a, b) => (b.last_active ?? '').localeCompare(a.last_active ?? ''))[0];
  if (recentOther) keep.add(recentOther.id);

  const latestChat = active
    .filter((s) => s.messaging_group_id !== CANONICAL_MG)
    .sort((a, b) => (b.last_active ?? '').localeCompare(a.last_active ?? ''))[0];
  if (latestChat) keep.add(latestChat.id);

  for (const s of active) {
    if (keep.has(s.id)) {
      console.log(`KEEP:${s.id} mg=${s.messaging_group_id}`);
      continue;
    }
    if (dryRun) {
      console.log(`DRY:retire ${s.id} mg=${s.messaging_group_id}`);
    } else {
      db.prepare("UPDATE sessions SET status = 'closed' WHERE id = ?").run(s.id);
      console.log(`OK:retired ${s.id}`);
    }
  }

  closeDb();
  console.log(`DONE${dryRun ? ' (dry-run)' : ''}`);
}

main();
