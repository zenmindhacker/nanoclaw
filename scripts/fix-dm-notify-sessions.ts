/**
 * Ensure Slack DM agents have a null-thread "notify" session for cron/briefings,
 * dedupe cycle tasks onto that session, and set DM wiring to per-thread.
 *
 * Usage:
 *   pnpm exec tsx scripts/fix-dm-notify-sessions.ts --dry-run
 *   pnpm exec tsx scripts/fix-dm-notify-sessions.ts
 *   pnpm exec tsx scripts/fix-dm-notify-sessions.ts --agent dm-with-christina
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { initDb, closeDb } from '../src/db/connection.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { cancelTask, insertTask } from '../src/modules/scheduling/db.js';
import { resolveSession, openInboundDb, initSessionFolder } from '../src/session-manager.js';

interface AgentFix {
  folder: string;
  messagingGroupId: string;
  /** Keep this recurrence; cancel other cycle-briefing series. */
  cycleRecurrence: string;
  cyclePrompt: string;
  cycleScript: string;
  cycleTaskId: string;
}

const FIXES: AgentFix[] = [
  {
    folder: 'dm-with-christina',
    messagingGroupId: 'mg-1779388264578-jk5zho',
    cycleRecurrence: '0 11 * * *',
    cycleTaskId: 'cycle-daily-briefing',
    cyclePrompt:
      "Deliver Christina's daily cycle briefing to Christina. The pre-task script attached today's briefing in scriptOutput.\n\nYou MUST call send_message with the FULL briefing text from scriptOutput (warm, supportive tone). Do not reply with only 'Standing by', internal notes, or completion claims without sending the briefing body. The host drops agent output that lacks a deliverable message.\n\nDo not re-run cycle_briefing.mjs unless scriptOutput is missing.",
    cycleScript: 'cd /workspace/agent && node cycle_briefing.mjs --task-json $(TZ=America/New_York date +%Y-%m-%d)',
  },
];

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
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function walkInboundDbs(agentGroupId: string): string[] {
  const root = path.join(DATA_DIR, 'v2-sessions', agentGroupId);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const sessionId of fs.readdirSync(root)) {
    const p = path.join(root, sessionId, 'inbound.db');
    if (fs.existsSync(p)) out.push(sessionId);
  }
  return out;
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const agentIdx = process.argv.indexOf('--agent');
  const onlyFolder = agentIdx >= 0 ? process.argv[agentIdx + 1] : null;

  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found');
    process.exit(1);
  }

  const db = initDb(v2DbPath);
  runMigrations(db);

  const fixes = onlyFolder ? FIXES.filter((f) => f.folder === onlyFolder) : FIXES;
  if (fixes.length === 0) {
    console.error(`No fix config for --agent ${onlyFolder}`);
    process.exit(1);
  }

  for (const fix of fixes) {
    const ag = getAgentGroupByFolder(fix.folder);
    if (!ag) {
      console.error(`SKIP: agent folder ${fix.folder} not found`);
      continue;
    }

    // 1. Force DM wiring to per-thread
    const wiring = db
      .prepare(
        `SELECT id, session_mode FROM messaging_group_agents
         WHERE agent_group_id = ? AND messaging_group_id = ?`,
      )
      .get(ag.id, fix.messagingGroupId) as { id: string; session_mode: string } | undefined;
    if (!wiring) {
      console.error(`SKIP: no wiring for ${fix.folder} / ${fix.messagingGroupId}`);
      continue;
    }
    if (wiring.session_mode !== 'per-thread') {
      if (dryRun) {
        console.log(`DRY:session_mode ${wiring.id} ${wiring.session_mode} → per-thread`);
      } else {
        db.prepare(`UPDATE messaging_group_agents SET session_mode = 'per-thread' WHERE id = ?`).run(
          wiring.id,
        );
        console.log(`OK:session_mode ${wiring.id} → per-thread`);
      }
    } else {
      console.log(`OK:session_mode already per-thread (${wiring.id})`);
    }

    // 2. Ensure null-thread notify session
    let notifySession = db
      .prepare(
        `SELECT id FROM sessions
         WHERE agent_group_id = ? AND messaging_group_id = ?
           AND thread_id IS NULL AND status = 'active'
         LIMIT 1`,
      )
      .get(ag.id, fix.messagingGroupId) as { id: string } | undefined;

    if (!notifySession) {
      if (dryRun) {
        console.log(`DRY:create null-thread notify session for ${fix.folder}`);
      } else {
        const { session } = resolveSession(ag.id, fix.messagingGroupId, null, 'per-thread');
        initSessionFolder(ag.id, session.id);
        notifySession = { id: session.id };
        console.log(`OK:created notify session ${session.id}`);
      }
    } else {
      console.log(`OK:notify session ${notifySession.id}`);
    }

    if (!notifySession && dryRun) {
      console.log('DRY:skip task migrate (no session id in dry-run create path)');
      continue;
    }
    if (!notifySession) continue;

    // 3. Cancel every pending cycle-ish task not on the notify session / not the canonical id
    for (const sessionId of walkInboundDbs(ag.id)) {
      const inboxDb = openInboundDb(ag.id, sessionId);
      try {
        const tasks = inboxDb
          .prepare(
            `SELECT id, status, recurrence, content FROM messages_in
             WHERE kind = 'task' AND status IN ('pending', 'paused', 'processing')`,
          )
          .all() as Array<{ id: string; status: string; recurrence: string | null; content: string }>;

        for (const task of tasks) {
          const isCycle =
            task.id === fix.cycleTaskId ||
            task.id.startsWith('cycle-') ||
            /cycle briefing/i.test(task.content) ||
            /daily cycle/i.test(task.content);
          if (!isCycle) continue;

          const keep =
            sessionId === notifySession.id &&
            task.id === fix.cycleTaskId &&
            task.recurrence === fix.cycleRecurrence;

          if (keep) {
            console.log(`KEEP:${task.id} on ${sessionId}`);
            continue;
          }

          if (dryRun) {
            console.log(`DRY:cancel ${task.id} on ${sessionId}`);
          } else {
            cancelTask(inboxDb, task.id);
            console.log(`OK:cancelled ${task.id} on ${sessionId}`);
          }
        }
      } finally {
        inboxDb.close();
      }
    }

    // 4. Ensure canonical cycle task on notify session
    const notifyInbound = path.join(DATA_DIR, 'v2-sessions', ag.id, notifySession.id, 'inbound.db');
    if (!fs.existsSync(notifyInbound) && !dryRun) {
      initSessionFolder(ag.id, notifySession.id);
    }
    if (dryRun && !fs.existsSync(notifyInbound)) {
      console.log(`DRY:insert ${fix.cycleTaskId} on new notify session`);
      continue;
    }

    const inboxDb = openInboundDb(ag.id, notifySession.id);
    try {
      const existing = inboxDb
        .prepare("SELECT id, status, recurrence FROM messages_in WHERE id = ? AND kind = 'task'")
        .get(fix.cycleTaskId) as { id: string; status: string; recurrence: string | null } | undefined;

      if (existing && (existing.status === 'pending' || existing.status === 'paused')) {
        console.log(`OK:exists ${fix.cycleTaskId} status=${existing.status}`);
      } else if (dryRun) {
        console.log(`DRY:insert ${fix.cycleTaskId} on ${notifySession.id}`);
      } else {
        if (existing) {
          inboxDb.prepare('DELETE FROM messages_in WHERE id = ?').run(fix.cycleTaskId);
        }
        insertTask(inboxDb, {
          id: fix.cycleTaskId,
          processAfter: nextCronRunUtc(fix.cycleRecurrence),
          recurrence: fix.cycleRecurrence,
          platformId: null,
          channelType: null,
          threadId: null,
          content: JSON.stringify({
            prompt: fix.cyclePrompt,
            script: fix.cycleScript,
            seeded_by: 'scripts/fix-dm-notify-sessions.ts',
          }),
        });
        console.log(`OK:inserted ${fix.cycleTaskId} on ${notifySession.id}`);
      }
    } finally {
      inboxDb.close();
    }
  }

  // Cleo DM: per-thread only (cron lives on slack_scheduled, not the DM)
  if (!onlyFolder || onlyFolder === 'dm-with-cian' || onlyFolder === 'cleo') {
    const cleoAg = getAgentGroupByFolder('dm-with-cian');
    if (!cleoAg) {
      console.log('SKIP:cleo agent folder dm-with-cian not found');
    } else {
      const cleoDm = db
        .prepare(
          `SELECT mga.id, mga.session_mode, mg.platform_id
           FROM messaging_group_agents mga
           JOIN messaging_groups mg ON mg.id = mga.messaging_group_id
           WHERE mga.agent_group_id = ?
             AND mg.channel_type = 'slack' AND mg.is_group = 0`,
        )
        .all(cleoAg.id) as Array<{ id: string; session_mode: string; platform_id: string }>;

      for (const row of cleoDm) {
        if (row.session_mode === 'per-thread') {
          console.log(`OK:cleo DM ${row.platform_id} already per-thread`);
          continue;
        }
        if (dryRun) {
          console.log(`DRY:cleo DM ${row.platform_id} ${row.session_mode} → per-thread`);
        } else {
          db.prepare(`UPDATE messaging_group_agents SET session_mode = 'per-thread' WHERE id = ?`).run(row.id);
          console.log(`OK:cleo DM ${row.platform_id} → per-thread`);
        }
      }
    }
  }

  closeDb();
  console.log(`DONE${dryRun ? ' (dry-run)' : ''}`);
}

main();
