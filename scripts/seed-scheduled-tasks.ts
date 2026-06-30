/**
 * Seed scheduled tasks from scripts/scheduled-tasks.manifest.json into session inbound DBs.
 * Idempotent: skips tasks that already exist (by id).
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-scheduled-tasks.ts
 *   pnpm exec tsx scripts/seed-scheduled-tasks.ts --dry-run
 *   pnpm exec tsx scripts/seed-scheduled-tasks.ts --session sess-1782170556889-ydslvi
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { DATA_DIR } from '../src/config.js';
import { initDb, closeDb } from '../src/db/connection.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { insertTask } from '../src/modules/scheduling/db.js';
import { openInboundDb } from '../src/session-manager.js';

interface ManifestTask {
  id: string;
  agentFolder: string;
  recurrence: string;
  prompt: string;
  script?: string | null;
}

/** Preferred messaging group per agent folder (Silas Christina DM). */
const PREFERRED_MESSAGING_GROUP: Record<string, string> = {
  'dm-with-christina': 'mg-1779388264578-jk5zho',
};

function parseSessionOverride(argv: string[]): string | null {
  const idx = argv.indexOf('--session');
  if (idx === -1) return null;
  const id = argv[idx + 1];
  if (!id) {
    console.error('--session requires a session id');
    process.exit(1);
  }
  return id;
}

function nextCronRunUtc(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return new Date().toISOString();
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return new Date().toISOString();

  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0),
  );
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.toISOString();
}

/**
 * Pick the best active session for seeding — not first alphabetically.
 * 1. Prefer active session on canonical messaging group for this agent folder.
 * 2. Fallback: most recently active session (last_active DESC).
 */
export function findSessionForAgent(
  agentGroupId: string,
  agentFolder: string,
  v2Db: Database.Database,
): string | null {
  const root = path.join(DATA_DIR, 'v2-sessions', agentGroupId);
  if (!fs.existsSync(root)) return null;

  const onDisk = new Set(
    fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, 'inbound.db'))),
  );
  if (onDisk.size === 0) return null;

  const preferredMg = PREFERRED_MESSAGING_GROUP[agentFolder];
  const rows = v2Db
    .prepare(
      `SELECT id, messaging_group_id, last_active, created_at
       FROM sessions
       WHERE agent_group_id = ? AND status = 'active'
       ORDER BY last_active DESC, created_at DESC`,
    )
    .all(agentGroupId) as Array<{
    id: string;
    messaging_group_id: string | null;
    last_active: string | null;
    created_at: string;
  }>;

  const active = rows.filter((r) => onDisk.has(r.id));
  if (active.length === 0) return [...onDisk].sort()[0] ?? null;

  if (preferredMg) {
    const canonical = active.find((r) => r.messaging_group_id === preferredMg);
    if (canonical) return canonical.id;
  }

  return active[0]!.id;
}

function loadManifest(): ManifestTask[] {
  const manifestPath = path.join(process.cwd(), 'scripts', 'scheduled-tasks.manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { tasks: ManifestTask[] };
  return raw.tasks ?? [];
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const sessionOverride = parseSessionOverride(process.argv);
  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found — set DATA_DIR or run from install root');
    process.exit(1);
  }

  const db = initDb(v2DbPath);
  runMigrations(db);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const task of loadManifest()) {
    try {
      const ag = getAgentGroupByFolder(task.agentFolder);
      if (!ag) {
        console.error(`SKIP:no agent group folder=${task.agentFolder}`);
        skipped++;
        continue;
      }

      let sessionId = sessionOverride;
      if (sessionId) {
        const inboundPath = path.join(DATA_DIR, 'v2-sessions', ag.id, sessionId, 'inbound.db');
        if (!fs.existsSync(inboundPath)) {
          console.error(`SKIP:session not found folder=${task.agentFolder} session=${sessionId}`);
          skipped++;
          continue;
        }
      } else {
        sessionId = findSessionForAgent(ag.id, task.agentFolder, db);
      }

      if (!sessionId) {
        console.error(`SKIP:no session for folder=${task.agentFolder}`);
        skipped++;
        continue;
      }

      const inboxDb = openInboundDb(ag.id, sessionId);
      try {
        const existing = inboxDb
          .prepare("SELECT id FROM messages_in WHERE id = ? AND kind = 'task'")
          .get(task.id) as { id: string } | undefined;
        if (existing) {
          console.log(`OK:exists:${task.id}`);
          skipped++;
          continue;
        }

        const processAfter = nextCronRunUtc(task.recurrence);
        const content = JSON.stringify({
          prompt: task.prompt,
          script: task.script ?? null,
          seeded_by: 'scripts/seed-scheduled-tasks.ts',
        });

        if (dryRun) {
          console.log(`DRY:${task.id} folder=${task.agentFolder} session=${sessionId} at=${processAfter}`);
          inserted++;
          continue;
        }

        insertTask(inboxDb, {
          id: task.id,
          processAfter,
          recurrence: task.recurrence,
          platformId: null,
          channelType: null,
          threadId: null,
          content,
        });
        console.log(`OK:inserted:${task.id} session=${sessionId} next=${processAfter}`);
        inserted++;
      } finally {
        inboxDb.close();
      }
    } catch (err) {
      failed++;
      console.error(
        `FAIL:${task.id}:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  closeDb();
  console.log(`DONE:inserted=${inserted},skipped=${skipped},failed=${failed}${dryRun ? ',dry-run' : ''}`);
}

main();
