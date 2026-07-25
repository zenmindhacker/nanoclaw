#!/usr/bin/env tsx
/**
 * Force all Slack DM wirings to session_mode=shared.
 *
 * Under Slack agent_view, each user message is its own thread root. Wiring a
 * DM as per-thread mints a new NanoClaw session per message and breaks
 * continuity / multiplies outbound replies. Router also coerces Slack DMs to
 * shared at runtime; this script keeps production DB state aligned.
 *
 * Usage:
 *   pnpm exec tsx scripts/force-slack-dm-shared.ts           # apply
 *   pnpm exec tsx scripts/force-slack-dm-shared.ts --dry-run
 */
import { closeDb, getDb } from '../src/db/index.js';

const dryRun = process.argv.includes('--dry-run');

function main(): void {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT mga.id, mga.session_mode, mga.agent_group_id, mg.platform_id, mg.name
       FROM messaging_group_agents mga
       JOIN messaging_groups mg ON mg.id = mga.messaging_group_id
       WHERE mg.channel_type = 'slack' AND mg.is_group = 0
         AND mga.session_mode != 'agent-shared'`,
    )
    .all() as Array<{
    id: string;
    session_mode: string;
    agent_group_id: string;
    platform_id: string;
    name: string | null;
  }>;

  if (rows.length === 0) {
    console.log('OK: no Slack DM wirings found');
    closeDb();
    return;
  }

  let updated = 0;
  for (const row of rows) {
    if (row.session_mode === 'shared') {
      console.log(`OK:already shared ${row.platform_id} (${row.name ?? row.id})`);
      continue;
    }
    if (dryRun) {
      console.log(`DRY: ${row.platform_id} ${row.session_mode} → shared (${row.name ?? row.id})`);
    } else {
      db.prepare(`UPDATE messaging_group_agents SET session_mode = 'shared' WHERE id = ?`).run(row.id);
      console.log(`OK: ${row.platform_id} ${row.session_mode} → shared (${row.name ?? row.id})`);
    }
    updated++;
  }

  console.log(`DONE${dryRun ? ' (dry-run)' : ''}: ${updated} wiring(s) to update, ${rows.length} Slack DM total`);
  closeDb();
}

main();
