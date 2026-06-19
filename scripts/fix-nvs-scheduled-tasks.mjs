#!/usr/bin/env node
/**
 * One-time production repair: cancel Cleo's duplicate NVS task and normalize
 * the canonical nvs-email-processor prompt (no HTTPS_PROXY / NO_PROXY hacks).
 *
 * Usage (repo root):
 *   node scripts/fix-nvs-scheduled-tasks.mjs
 *   node scripts/fix-nvs-scheduled-tasks.mjs --dry-run
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.DATA_DIR || 'data';
const DRY = process.argv.includes('--dry-run');

const ORIG_INBOUND = path.join(
  DATA_DIR,
  'v2-sessions/ag-1779305793650-yffcyh/sess-1779305793654-nnzhoi/inbound.db',
);
const DUP_INBOUND = path.join(
  DATA_DIR,
  'v2-sessions/ag-1779305793766-x8xwuv/sess-1781728493257-i4ptbw/inbound.db',
);
const DUP_SERIES_ID = 'task-1781729575099-lcu1uv';
const ORIG_SERIES_ID = 'nvs-email-processor';
const XERO_TOKENS = path.join(
  process.env.HOME || '',
  '.config/nanoclaw/credentials/services/xero-tokens.json',
);

export const NVS_TASK_PROMPT = `Run the NVS email processor to check for new AR and AP emails from New Value Solutions and create corresponding Xero bills/invoices.

Execute:
\`\`\`bash
cd /workspace/extra/skills/invoice-generator && node scripts/nvs-processor.mjs --flow all
\`\`\`

After running, inspect the output for a \`PENDING_DECISIONS_START\` ... \`PENDING_DECISIONS_END\` JSON block. If present, the script found emails it couldn't auto-process. Do NOT ignore them — post a message to #sysops (slack:C07F195GB96) listing each one (id, subject, date, reason) and ask Cian whether to skip them or retry. Wait for his reply in the channel. Based on his answer:

- To mark as skipped (won't be re-asked): \`node scripts/nvs-processor.mjs --skip-ids id1,id2,id3\`
- To clear the review flag so they get re-evaluated next run: \`node scripts/nvs-processor.mjs --retry-ids id1,id2,id3\`

Other outcomes:
- If new bills or invoices were created, post a summary to #sysops with what was created, amounts, and any hour discrepancies flagged.
- If there were errors, post the error details to #sysops.
- If no new emails were found AND no pending decisions, post a one-line "NVS: no new emails" to #sysops.

Record successful completion:
\`\`\`bash
mkdir -p /workspace/group/task-state
date -u +%Y-%m-%dT%H:%M:%SZ > /workspace/group/task-state/nvs-email-processor.last-run
\`\`\``;

function cancelSeries(db, seriesId) {
  const info = db
    .prepare(
      "UPDATE messages_in SET status = 'completed', recurrence = NULL WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status IN ('pending', 'paused')",
    )
    .run(seriesId, seriesId);
  return info.changes;
}

function updateSeriesPrompt(db, seriesId, prompt) {
  const rows = db
    .prepare(
      "SELECT id, content FROM messages_in WHERE (id = ? OR series_id = ?) AND kind = 'task' AND status IN ('pending', 'paused')",
    )
    .all(seriesId, seriesId);

  let touched = 0;
  for (const row of rows) {
    let parsed;
    try {
      parsed = JSON.parse(row.content);
    } catch {
      parsed = { prompt: row.content };
    }
    parsed.prompt = prompt;
    parsed.script = null;
    if (!DRY) {
      db.prepare('UPDATE messages_in SET content = ? WHERE id = ?').run(JSON.stringify(parsed), row.id);
    }
    touched++;
  }
  return touched;
}

function stripStaleXeroExpiryDate() {
  if (!fs.existsSync(XERO_TOKENS)) {
    console.log('SKIP: xero-tokens.json not found');
    return;
  }
  const tokens = JSON.parse(fs.readFileSync(XERO_TOKENS, 'utf8'));
  if (!('expiry_date' in tokens)) {
    console.log('OK: xero-tokens.json has no expiry_date');
    return;
  }
  delete tokens.expiry_date;
  if (!DRY) {
    fs.writeFileSync(XERO_TOKENS, JSON.stringify(tokens, null, 2) + '\n');
  }
  console.log(`${DRY ? 'DRY' : 'OK'}: removed stale expiry_date from xero-tokens.json`);
}

function main() {
  if (!fs.existsSync(ORIG_INBOUND)) {
    console.error('Missing canonical session inbound.db:', ORIG_INBOUND);
    process.exit(1);
  }

  console.log(DRY ? 'DRY RUN' : 'Applying NVS scheduled-task repair');

  if (fs.existsSync(DUP_INBOUND)) {
    const dupDb = new Database(DUP_INBOUND);
    const cancelled = cancelSeries(dupDb, DUP_SERIES_ID);
    console.log(`${DRY ? 'DRY' : 'OK'}: cancelled ${cancelled} duplicate task row(s) series=${DUP_SERIES_ID}`);
    dupDb.close();
  } else {
    console.log('SKIP: duplicate session inbound.db not found');
  }

  const origDb = new Database(ORIG_INBOUND);
  const updated = updateSeriesPrompt(origDb, ORIG_SERIES_ID, NVS_TASK_PROMPT);
  console.log(`${DRY ? 'DRY' : 'OK'}: updated ${updated} canonical nvs-email-processor row(s)`);
  origDb.close();

  stripStaleXeroExpiryDate();
}

main();
