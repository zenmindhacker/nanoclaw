/**
 * Seed scheduled tasks from scripts/scheduled-tasks.manifest.json into session inbound DBs.
 * Idempotent: skips tasks that already exist (by id).
 *
 * Usage:
 *   pnpm exec tsx scripts/seed-scheduled-tasks.ts
 *   pnpm exec tsx scripts/seed-scheduled-tasks.ts --dry-run
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';

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

function nextCronRunUtc(cron: string): string {
  return CronExpressionParser.parse(cron, { tz: 'UTC' }).next().toISOString();
}

function findSessionForAgent(agentGroupId: string): string | null {
  const root = path.join(DATA_DIR, 'v2-sessions', agentGroupId);
  if (!fs.existsSync(root)) return null;
  const sessions = fs.readdirSync(root).filter((name) => {
    const p = path.join(root, name, 'inbound.db');
    return fs.existsSync(p);
  });
  return sessions[0] ?? null;
}

function loadManifest(): ManifestTask[] {
  const manifestPath = path.join(process.cwd(), 'scripts', 'scheduled-tasks.manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { tasks: ManifestTask[] };
  return raw.tasks ?? [];
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
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

      const sessionId = findSessionForAgent(ag.id);
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
