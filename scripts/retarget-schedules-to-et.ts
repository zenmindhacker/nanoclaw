/**
 * One-shot: retarget UTC-era Silas crons to America/New_York wall times.
 *   cycle 0 11 * * * (UTC) → 0 7 * * * (ET)
 *   orders-mvp 0 11,16,19,22 → 0 7,12,15,18
 *
 *   pnpm exec tsx scripts/retarget-schedules-to-et.ts
 *   pnpm exec tsx scripts/retarget-schedules-to-et.ts --dry-run
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

import { updateTask } from '../src/modules/scheduling/db.js';

const dryRun = process.argv.includes('--dry-run');
/** Next 7:00 America/New_York (EDT = UTC-4) from "today" context — Jul 26 2026. */
const NEXT_7AM_ET = '2026-07-26T11:00:00.000Z';

const MANIFEST_UPDATES: Array<{ id: string; recurrence: string }> = [
  { id: 'cycle-daily-briefing', recurrence: '0 7 * * *' },
  { id: 'orders-mvp-sync', recurrence: '0 7,12,15,18 * * *' },
];

function walkInboundDbs(root: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(root)) return out;
  for (const ag of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ag.isDirectory()) continue;
    const agPath = path.join(root, ag.name);
    for (const sess of fs.readdirSync(agPath, { withFileTypes: true })) {
      if (!sess.isDirectory()) continue;
      const dbPath = path.join(agPath, sess.name, 'inbound.db');
      if (fs.existsSync(dbPath)) out.push(dbPath);
    }
  }
  return out;
}

let touched = 0;
for (const dbPath of walkInboundDbs(path.join('data', 'v2-sessions'))) {
  const db = new Database(dbPath);
  const pending = db
    .prepare(
      `SELECT id, series_id, recurrence, process_after, status
       FROM messages_in WHERE kind = 'task' AND status = 'pending'`,
    )
    .all() as Array<{
    id: string;
    series_id: string | null;
    recurrence: string | null;
    process_after: string;
  }>;

  for (const row of pending) {
    for (const u of MANIFEST_UPDATES) {
      if (row.id === u.id || row.series_id === u.id) {
        console.log(
          `${dryRun ? 'DRY' : 'OK'}: ${path.basename(path.dirname(dbPath))} ${row.id} ${row.recurrence} → ${u.recurrence}`,
        );
        if (!dryRun) {
          updateTask(db, row.id, {
            recurrence: u.recurrence,
            processAfter: NEXT_7AM_ET,
          });
        }
        touched++;
      }
    }
    // Other pending dailies still on the old UTC 11:00 slot → 7:00 ET
    if (
      row.recurrence === '0 11 * * *' &&
      row.id !== 'cycle-daily-briefing' &&
      row.series_id !== 'cycle-daily-briefing' &&
      row.id !== 'orders-mvp-sync'
    ) {
      console.log(
        `${dryRun ? 'DRY' : 'OK'}: ${path.basename(path.dirname(dbPath))} ${row.id} 0 11 * * * → 0 7 * * *`,
      );
      if (!dryRun) {
        updateTask(db, row.id, {
          recurrence: '0 7 * * *',
          processAfter: NEXT_7AM_ET,
        });
      }
      touched++;
    }
  }
  db.close();
}

console.log(`DONE:touched=${touched}${dryRun ? ',dry-run' : ''}`);
