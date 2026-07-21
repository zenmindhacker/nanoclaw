/**
 * Force-apply a stuck install_packages approval (when Slack button clicks
 * aren't reaching the host). Uses the same handler as an Approve click.
 *
 * Usage:
 *   pnpm exec tsx scripts/approve-pending-install.ts --id appr-...
 *   pnpm exec tsx scripts/approve-pending-install.ts --latest
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { initDb, closeDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { deletePendingApproval, getPendingApproval, getSession } from '../src/db/sessions.js';
import { applyInstallPackages } from '../src/modules/self-mod/apply.js';
import { notifyAgent } from '../src/modules/approvals/primitive.js';

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main(): Promise<void> {
  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found');
    process.exit(1);
  }
  const db = initDb(v2DbPath);
  runMigrations(db);

  let approvalId = argValue('--id');
  if (!approvalId && process.argv.includes('--latest')) {
    const row = db
      .prepare(
        `SELECT approval_id FROM pending_approvals
         WHERE action = 'install_packages' AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as { approval_id: string } | undefined;
    approvalId = row?.approval_id ?? null;
  }
  if (!approvalId) {
    console.error('Usage: --id appr-...  or  --latest');
    process.exit(1);
  }

  const approval = getPendingApproval(approvalId);
  if (!approval || approval.action !== 'install_packages') {
    console.error(`No pending install_packages approval ${approvalId}`);
    process.exit(1);
  }
  if (!approval.session_id) {
    console.error('Approval has no session_id');
    process.exit(1);
  }
  const session = getSession(approval.session_id);
  if (!session) {
    console.error(`Session ${approval.session_id} missing`);
    process.exit(1);
  }

  const payload = JSON.parse(approval.payload) as Record<string, unknown>;
  console.log(`Applying ${approvalId} on ${session.id}:`, payload);

  await applyInstallPackages({
    session,
    payload,
    userId: 'cli:approve-pending-install',
    notify: (text) => notifyAgent(session, text),
  });

  deletePendingApproval(approvalId);
  console.log('OK: applied and deleted pending row');
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
