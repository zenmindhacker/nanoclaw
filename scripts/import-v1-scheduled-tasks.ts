/**
 * Import active v1 scheduled_tasks into v2 session inbound DBs.
 *
 * This is a targeted recovery helper for installs where v2 is already running
 * but old v1 scheduled tasks were still living in store/messages.db.
 *
 * Usage:
 *   pnpm exec tsx scripts/import-v1-scheduled-tasks.ts <v1-root>
 *   pnpm exec tsx scripts/import-v1-scheduled-tasks.ts <v1-root> --dry-run
 */
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';
import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, TIMEZONE } from '../src/config.js';
import { ensureContainerConfig } from '../src/db/container-configs.js';
import { createAgentGroup, getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { initDb, closeDb } from '../src/db/connection.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroupAgentByPair,
  getMessagingGroupByPlatform,
} from '../src/db/messaging-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { insertTask } from '../src/modules/scheduling/db.js';
import { openInboundDb, resolveSession } from '../src/session-manager.js';
import { generateId, inferIsGroup, parseJid, triggerToEngage, v2PlatformId } from '../setup/migrate-v2/shared.js';

interface V1Group {
  jid: string;
  name: string;
  folder: string;
  trigger_pattern: string | null;
  requires_trigger: number | null;
}

interface V1Task {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  next_run: string | null;
  status: string;
  context_mode: string | null;
  script: string | null;
}

const SKIP_TASK_IDS = new Set([
  // Host src/oauth-refresher.ts owns refresh. Legacy task wrote tokens from container.
  // Use oauth-health-check in scripts/scheduled-tasks.manifest.json instead.
  'oauth-token-refresh',
]);

function nextProcessAfter(task: V1Task): { processAfter: string; recurrence: string | null } | null {
  const now = new Date();

  if (task.schedule_type === 'cron') {
    const recurrence = task.schedule_value.trim();
    const fields = recurrence.split(/\s+/).length;
    if (fields < 5 || fields > 6) return null;

    const candidate = task.next_run ? new Date(task.next_run) : null;
    if (candidate && !Number.isNaN(candidate.getTime()) && candidate > now) {
      return { processAfter: candidate.toISOString(), recurrence };
    }

    // Avoid immediate stampedes when importing stale v1 rows.
    const interval = CronExpressionParser.parse(recurrence, { tz: TIMEZONE });
    return { processAfter: interval.next().toISOString(), recurrence };
  }

  if (task.schedule_type === 'interval') {
    const match = /^(\d+)([smhd])$/.exec(task.schedule_value.trim());
    if (!match) return null;
    const n = Number(match[1]);
    const unit = match[2];
    let recurrence: string | null = null;
    if (unit === 'm' && n < 60) recurrence = `*/${n} * * * *`;
    else if (unit === 'h' && n < 24) recurrence = `0 */${n} * * *`;
    else if (unit === 'd' && n < 28) recurrence = `0 0 */${n} * *`;
    if (!recurrence) return null;

    const interval = CronExpressionParser.parse(recurrence, { tz: TIMEZONE });
    return { processAfter: interval.next().toISOString(), recurrence };
  }

  if (task.schedule_type === 'once' || task.schedule_type === 'at') {
    return { processAfter: task.next_run ?? task.schedule_value ?? now.toISOString(), recurrence: null };
  }

  return null;
}

function ensureAgentGroup(group: V1Group): string {
  let ag = getAgentGroupByFolder(group.folder);
  if (!ag) {
    createAgentGroup({
      id: generateId('ag'),
      name: group.name || group.folder,
      folder: group.folder,
      agent_provider: null,
      created_at: new Date().toISOString(),
    });
    ag = getAgentGroupByFolder(group.folder);
  }
  if (!ag) throw new Error(`Failed to create agent group for ${group.folder}`);
  ensureContainerConfig(ag.id);
  return ag.id;
}

function ensureMessagingGroup(task: V1Task, group: V1Group): { id: string; channelType: string; platformId: string } {
  const parsed = parseJid(task.chat_jid);
  if (!parsed) throw new Error(`Could not parse chat_jid: ${task.chat_jid}`);

  const channelType = parsed.channel_type;
  const platformId = v2PlatformId(channelType, parsed.raw);
  let mg = getMessagingGroupByPlatform(channelType, platformId);
  if (!mg) {
    createMessagingGroup({
      id: generateId('mg'),
      channel_type: channelType,
      platform_id: platformId,
      name: group.name || group.folder,
      is_group: inferIsGroup(channelType, platformId),
      unknown_sender_policy: 'public',
      created_at: new Date().toISOString(),
    });
    mg = getMessagingGroupByPlatform(channelType, platformId);
  }
  if (!mg) throw new Error(`Failed to create messaging group for ${task.chat_jid}`);
  return { id: mg.id, channelType, platformId };
}

function ensureWiring(messagingGroupId: string, agentGroupId: string, group: V1Group): void {
  if (getMessagingGroupAgentByPair(messagingGroupId, agentGroupId)) return;

  const engage = triggerToEngage({
    trigger_pattern: group.trigger_pattern,
    requires_trigger: group.requires_trigger,
  });
  createMessagingGroupAgent({
    id: generateId('mga'),
    messaging_group_id: messagingGroupId,
    agent_group_id: agentGroupId,
    engage_mode: engage.engage_mode,
    engage_pattern: engage.engage_pattern,
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: new Date().toISOString(),
  });
}

function main(): void {
  const v1Root = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!v1Root) {
    console.error('Usage: tsx scripts/import-v1-scheduled-tasks.ts <v1-root> [--dry-run]');
    process.exit(1);
  }

  const v1DbPath = path.join(v1Root, 'store', 'messages.db');
  if (!fs.existsSync(v1DbPath)) {
    console.error(`v1 DB not found: ${v1DbPath}`);
    process.exit(1);
  }

  const v1Db = new Database(v1DbPath, { readonly: true, fileMustExist: true });
  const groups = new Map(
    (v1Db
      .prepare('SELECT jid, name, folder, trigger_pattern, requires_trigger FROM registered_groups')
      .all() as V1Group[]).map((g) => [g.folder, g]),
  );
  const tasks = v1Db
    .prepare('SELECT * FROM scheduled_tasks WHERE status = ? ORDER BY id')
    .all('active') as V1Task[];
  v1Db.close();

  if (!fs.existsSync(path.join(DATA_DIR, 'v2.db'))) {
    console.error(`v2 DB not found: ${path.join(DATA_DIR, 'v2.db')}`);
    process.exit(1);
  }

  const v2Db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(v2Db);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const task of tasks) {
    try {
      if (SKIP_TASK_IDS.has(task.id)) {
        console.log(`SKIP:${task.id}: superseded by host OAuth refresher`);
        skipped++;
        continue;
      }

      const group = groups.get(task.group_folder);
      if (!group) {
        console.error(`SKIP:${task.id}: missing registered group ${task.group_folder}`);
        skipped++;
        continue;
      }

      const schedule = nextProcessAfter(task);
      if (!schedule) {
        console.error(`SKIP:${task.id}: unsupported schedule ${task.schedule_type}:${task.schedule_value}`);
        skipped++;
        continue;
      }

      const agentGroupId = ensureAgentGroup(group);
      const messagingGroup = ensureMessagingGroup(task, group);
      ensureWiring(messagingGroup.id, agentGroupId, group);
      const { session } = resolveSession(agentGroupId, messagingGroup.id, null, 'shared');
      const inboxDb = openInboundDb(agentGroupId, session.id);
      try {
        const existing = inboxDb
          .prepare("SELECT id FROM messages_in WHERE id = ? AND kind = 'task'")
          .get(task.id) as { id: string } | undefined;
        if (existing) {
          console.log(`OK:exists:${task.id}`);
          skipped++;
          continue;
        }

        if (dryRun) {
          console.log(`DRY:${task.id}:${task.group_folder}:${session.id}:${schedule.processAfter}`);
          inserted++;
          continue;
        }

        insertTask(inboxDb, {
          id: task.id,
          processAfter: schedule.processAfter,
          recurrence: schedule.recurrence,
          platformId: messagingGroup.platformId,
          channelType: messagingGroup.channelType,
          threadId: null,
          content: JSON.stringify({
            prompt: task.prompt,
            script: task.script ?? null,
            migrated_from_v1: {
              original_id: task.id,
              group_folder: task.group_folder,
              chat_jid: task.chat_jid,
              context_mode: task.context_mode,
            },
          }),
        });
        console.log(`OK:inserted:${task.id}:${task.group_folder}:${session.id}:${schedule.processAfter}`);
        inserted++;
      } finally {
        inboxDb.close();
      }
    } catch (err) {
      failed++;
      console.error(`FAIL:${task.id}:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  closeDb();
  console.log(`DONE:active=${tasks.length},inserted=${inserted},skipped=${skipped},failed=${failed}${dryRun ? ',dry-run' : ''}`);
  if (failed > 0) process.exit(1);
}

main();
