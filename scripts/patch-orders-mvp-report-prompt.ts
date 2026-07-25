/**
 * Patch live orders-mvp-sync task prompt from the manifest (prompt only).
 *   pnpm exec tsx scripts/patch-orders-mvp-report-prompt.ts
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { updateTask } from '../src/modules/scheduling/db.js';

const TASK_ID = 'orders-mvp-sync';
const manifest = JSON.parse(
  fs.readFileSync(path.join('scripts', 'scheduled-tasks.manifest.json'), 'utf8'),
) as { tasks: Array<{ id: string; prompt: string }> };
const task = manifest.tasks.find((t) => t.id === TASK_ID);
if (!task?.prompt) {
  console.error('orders-mvp-sync prompt missing from manifest');
  process.exit(1);
}

const root = path.join('data', 'v2-sessions');
let touched = 0;
for (const ag of fs.readdirSync(root, { withFileTypes: true })) {
  if (!ag.isDirectory()) continue;
  for (const sess of fs.readdirSync(path.join(root, ag.name), { withFileTypes: true })) {
    if (!sess.isDirectory()) continue;
    const dbPath = path.join(root, ag.name, sess.name, 'inbound.db');
    if (!fs.existsSync(dbPath)) continue;
    const db = new Database(dbPath);
    const row = db
      .prepare(
        `SELECT id FROM messages_in WHERE kind = 'task' AND (id = ? OR series_id = ?) AND status = 'pending'`,
      )
      .get(TASK_ID, TASK_ID) as { id: string } | undefined;
    if (row) {
      updateTask(db, row.id, { prompt: task.prompt });
      console.log(`OK: ${sess.name} ${row.id}`);
      touched++;
    }
    db.close();
  }
}
console.log(`DONE:touched=${touched}`);
