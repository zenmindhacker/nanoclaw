/**
 * Wire Silas → #ai-bot (slack:C0APUHPBE5Q) as an outbound destination
 * (and optional mention wiring), then project destinations into sessions.
 *
 * Usage (on christina@cleo):
 *   pnpm exec tsx scripts/wire-silas-ai-bot.ts
 *   pnpm exec tsx scripts/wire-silas-ai-bot.ts --dry-run
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { initDb, closeDb, hasTable } from '../src/db/connection.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroupByPlatform,
} from '../src/db/messaging-groups.js';
import { getSessionsByAgentGroup } from '../src/db/sessions.js';
import { createDestination, getDestinationByName, getDestinationByTarget } from '../src/modules/agent-to-agent/db/agent-destinations.js';

const PLATFORM_ID = 'slack:C0APUHPBE5Q';
const CHANNEL_NAME = 'ai-bot';
const LOCAL_NAME = 'ai-bot';
const AGENT_FOLDER = 'dm-with-christina';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const v2DbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(v2DbPath)) {
    console.error('v2.db not found');
    process.exit(1);
  }

  const db = initDb(v2DbPath);
  runMigrations(db);

  const ag = getAgentGroupByFolder(AGENT_FOLDER);
  if (!ag) {
    console.error(`Agent folder ${AGENT_FOLDER} not found`);
    process.exit(1);
  }

  let mg = getMessagingGroupByPlatform('slack', PLATFORM_ID);
  if (!mg) {
    const id = `mg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mg = {
      id,
      channel_type: 'slack',
      platform_id: PLATFORM_ID,
      name: CHANNEL_NAME,
      is_group: 1,
      unknown_sender_policy: 'request_approval',
      created_at: new Date().toISOString(),
    };
    if (dryRun) {
      console.log(`DRY:create messaging_group ${id} ${PLATFORM_ID}`);
    } else {
      createMessagingGroup(mg);
      console.log(`OK:created messaging_group ${id}`);
    }
  } else {
    console.log(`OK:messaging_group exists ${mg.id} (${mg.platform_id})`);
  }

  // Destination (outbound ACL + local name)
  if (hasTable(db, 'agent_destinations')) {
    const byTarget = getDestinationByTarget(ag.id, 'channel', mg.id);
    const byName = getDestinationByName(ag.id, LOCAL_NAME);
    if (byTarget && byName) {
      console.log(`OK:destination ${LOCAL_NAME} → ${mg.id}`);
    } else if (dryRun) {
      console.log(`DRY:destination ${LOCAL_NAME} → ${mg.id}`);
    } else {
      if (!byTarget && !byName) {
        createDestination({
          agent_group_id: ag.id,
          local_name: LOCAL_NAME,
          target_type: 'channel',
          target_id: mg.id,
          created_at: new Date().toISOString(),
        });
        console.log(`OK:created destination ${LOCAL_NAME}`);
      } else if (byName && !byTarget) {
        console.log(`WARN: local_name ${LOCAL_NAME} already points elsewhere (${byName.target_id})`);
      } else {
        console.log(`OK:destination target exists as ${byTarget!.local_name}`);
      }
    }
  }

  // Wiring so inbound mentions also work (optional but useful)
  const existingWiring = db
    .prepare(
      `SELECT id FROM messaging_group_agents
       WHERE messaging_group_id = ? AND agent_group_id = ?`,
    )
    .get(mg.id, ag.id) as { id: string } | undefined;

  if (existingWiring) {
    console.log(`OK:wiring exists ${existingWiring.id}`);
  } else if (dryRun) {
    console.log(`DRY:create wiring mention → ${ag.folder}`);
  } else {
    createMessagingGroupAgent({
      id: `mga-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      messaging_group_id: mg.id,
      agent_group_id: ag.id,
      engage_mode: 'mention',
      engage_pattern: null,
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'per-thread',
      priority: 0,
      created_at: new Date().toISOString(),
    });
    console.log('OK:created wiring (engage=mention, session_mode=per-thread)');
  }

  if (!dryRun && hasTable(db, 'agent_destinations')) {
    const { writeDestinations } = await import('../src/modules/agent-to-agent/write-destinations.js');
    for (const session of getSessionsByAgentGroup(ag.id)) {
      try {
        writeDestinations(ag.id, session.id);
        console.log(`OK:projected destinations → ${session.id}`);
      } catch (err) {
        console.warn(`WARN:project ${session.id}:`, err);
      }
    }
  }

  closeDb();
  console.log(`DONE${dryRun ? ' (dry-run)' : ''}`);
  console.log(`Silas can send_message({ to: "${LOCAL_NAME}", text: "..." })`);
  console.log('Ensure the Silas Slack bot is a member of #ai-bot.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
