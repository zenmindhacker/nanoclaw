const Database = require('better-sqlite3');
const db = new Database('store/messages.db');
const newPrompt = `Run the NVS email processor to check for new AR and AP emails from New Value Solutions and create corresponding Xero bills/invoices.

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
db.prepare('UPDATE scheduled_tasks SET prompt = ? WHERE id = ?').run(newPrompt, 'nvs-email-processor');
console.log('Updated.');
console.log('--- new prompt ---');
console.log(db.prepare('SELECT prompt FROM scheduled_tasks WHERE id = ?').get('nvs-email-processor').prompt);
