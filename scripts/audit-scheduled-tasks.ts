/**
 * List v2 scheduled tasks across all session inbound DBs and compare to manifest.
 *
 * Usage (from repo root):
 *   pnpm exec tsx scripts/audit-scheduled-tasks.ts
 *   pnpm exec tsx scripts/audit-scheduled-tasks.ts --json
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { DATA_DIR } from '../src/config.js';
import { initDb, closeDb } from '../src/db/connection.js';
import { getAgentGroup } from '../src/db/agent-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';

interface TaskRow {
  id: string;
  status: string;
  process_after: string | null;
  recurrence: string | null;
  content: string;
}

interface ManifestTask {
  id: string;
  agentFolder: string;
  recurrence: string;
  prompt: string;
  script?: string;
}

interface AuditEntry {
  agentGroupId: string;
  agentFolder: string;
  sessionId: string;
  taskId: string;
  status: string;
  processAfter: string | null;
  recurrence: string | null;
  promptPreview: string;
  scriptPreview: string | null;
  scriptFilesOk: boolean | null;
}

function sessionsRoot(): string {
  return path.join(DATA_DIR, 'v2-sessions');
}

function scanSessionTasks(agentGroupId: string, sessionId: string): AuditEntry[] {
  const inboundPath = path.join(sessionsRoot(), agentGroupId, sessionId, 'inbound.db');
  if (!fs.existsSync(inboundPath)) return [];

  const db = new Database(inboundPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id, status, process_after, recurrence, content
         FROM messages_in WHERE kind = 'task' ORDER BY process_after`,
      )
      .all() as TaskRow[];

    const ag = getAgentGroup(agentGroupId);
    const folder = ag?.folder ?? agentGroupId;

    return rows.map((row) => {
      let promptPreview = '';
      let scriptPreview: string | null = null;
      try {
        const parsed = JSON.parse(row.content) as { prompt?: string; script?: string };
        promptPreview = (parsed.prompt ?? '').slice(0, 120);
        scriptPreview = parsed.script ? parsed.script.slice(0, 160) : null;
      } catch {
        promptPreview = row.content.slice(0, 120);
      }

      return {
        agentGroupId,
        agentFolder: folder,
        sessionId,
        taskId: row.id,
        status: row.status,
        processAfter: row.process_after,
        recurrence: row.recurrence,
        promptPreview,
        scriptPreview,
        scriptFilesOk: null,
      };
    });
  } finally {
    db.close();
  }
}

function scanAll(): AuditEntry[] {
  const root = sessionsRoot();
  if (!fs.existsSync(root)) return [];

  const entries: AuditEntry[] = [];
  for (const agentGroupId of fs.readdirSync(root)) {
    const agDir = path.join(root, agentGroupId);
    if (!fs.statSync(agDir).isDirectory()) continue;
    for (const sessionId of fs.readdirSync(agDir)) {
      const sessDir = path.join(agDir, sessionId);
      if (!fs.statSync(sessDir).isDirectory()) continue;
      entries.push(...scanSessionTasks(agentGroupId, sessionId));
    }
  }
  return entries;
}

function loadManifest(): ManifestTask[] {
  const manifestPath = path.join(process.cwd(), 'scripts', 'scheduled-tasks.manifest.json');
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { tasks: ManifestTask[] };
  return raw.tasks ?? [];
}

function main(): void {
  const jsonOut = process.argv.includes('--json');
  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found at', v2DbPath);
    process.exit(1);
  }

  const db = initDb(v2DbPath);
  runMigrations(db);

  const found = scanAll();
  const manifest = loadManifest();
  const foundIds = new Set(found.map((e) => `${e.agentFolder}:${e.taskId}`));

  const missingFromDb = manifest.filter((m) => !foundIds.has(`${m.agentFolder}:${m.id}`));

  if (jsonOut) {
    console.log(JSON.stringify({ found, missingFromDb }, null, 2));
  } else {
    console.log('# Scheduled task audit\n');
    console.log(`Sessions root: ${sessionsRoot()}\n`);
    if (found.length === 0) {
      console.log('No task rows in any session inbound.db.\n');
    } else {
      for (const e of found) {
        console.log(
          `- ${e.agentFolder} / ${e.sessionId} / ${e.taskId}: status=${e.status} next=${e.processAfter} cron=${e.recurrence}`,
        );
        console.log(`  prompt: ${e.promptPreview}`);
        if (e.scriptPreview) console.log(`  script: ${e.scriptPreview}`);
      }
      console.log('');
    }
    if (missingFromDb.length > 0) {
      console.log('Manifest tasks not present in DB (run seed-scheduled-tasks.ts):');
      for (const m of missingFromDb) {
        console.log(`  - ${m.agentFolder}:${m.id} (${m.recurrence})`);
      }
      console.log('');
    }
  }

  closeDb();
}

main();
