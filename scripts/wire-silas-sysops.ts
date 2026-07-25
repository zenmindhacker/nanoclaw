/**
 * Wire Silas → #sysops (slack:C07F195GB96) as an outbound destination from
 * every session, then project destinations into active session inbound DBs.
 *
 * Does not add inbound engage wiring — Cleo owns #sysops replies. This only
 * authorizes Silas to send_message / <message to="sysops"> from any session.
 *
 * Usage (on christina@cleo):
 *   pnpm exec tsx scripts/wire-silas-sysops.ts
 *   pnpm exec tsx scripts/wire-silas-sysops.ts --dry-run
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../src/config.js';
import { closeDb, hasTable, initDb } from '../src/db/connection.js';
import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { createMessagingGroup, getMessagingGroupByPlatform } from '../src/db/messaging-groups.js';
import { getSessionsByAgentGroup } from '../src/db/sessions.js';
import { readEnvFile } from '../src/env.js';
import {
  createDestination,
  getDestinationByName,
  getDestinationByTarget,
} from '../src/modules/agent-to-agent/db/agent-destinations.js';

const PLATFORM_ID = 'slack:C07F195GB96';
const CHANNEL_ID = 'C07F195GB96';
const CHANNEL_NAME = 'sysops';
const LOCAL_NAMES = ['sysops', 'slack_sysops'] as const;
const AGENT_FOLDER = 'dm-with-christina';

async function ensureBotInChannel(): Promise<void> {
  const env = readEnvFile(['SLACK_BOT_TOKEN']);
  const token = env.SLACK_BOT_TOKEN ?? process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn('WARN: no SLACK_BOT_TOKEN — cannot verify/join #sysops');
    return;
  }

  const auth = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const authBody = (await auth.json()) as { ok?: boolean; error?: string; user?: string };
  if (!authBody.ok) {
    console.warn(`WARN: Slack auth.test failed: ${authBody.error}`);
    return;
  }
  console.log(`OK:slack bot ${authBody.user}`);

  const info = await fetch('https://slack.com/api/conversations.info', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `channel=${CHANNEL_ID}`,
  });
  const infoBody = (await info.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { name?: string; is_member?: boolean };
  };
  if (infoBody.ok && infoBody.channel?.is_member) {
    console.log(`OK:already in #${infoBody.channel.name ?? CHANNEL_NAME}`);
    return;
  }
  if (infoBody.ok === false && infoBody.error !== 'channel_not_found' && infoBody.error !== 'not_in_channel') {
    console.warn(`WARN:conversations.info: ${infoBody.error}`);
  }

  const join = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `channel=${CHANNEL_ID}`,
  });
  const joinBody = (await join.json()) as { ok?: boolean; error?: string };
  if (joinBody.ok) {
    console.log('OK:joined #sysops');
  } else {
    console.warn(
      `WARN:conversations.join failed (${joinBody.error}). Invite the Silas bot to #sysops in Slack if needed.`,
    );
  }
}

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
      unknown_sender_policy: 'public',
      created_at: new Date().toISOString(),
    };
    if (dryRun) {
      console.log(`DRY:create messaging_group ${id} ${PLATFORM_ID}`);
    } else {
      createMessagingGroup(mg);
      console.log(`OK:created messaging_group ${id} (${PLATFORM_ID})`);
    }
  } else {
    console.log(`OK:messaging_group exists ${mg.id} (${mg.platform_id} / ${mg.name})`);
  }

  if (hasTable(db, 'agent_destinations')) {
    for (const localName of LOCAL_NAMES) {
      const byName = getDestinationByName(ag.id, localName);
      const byTarget = getDestinationByTarget(ag.id, 'channel', mg.id);
      if (byName && byName.target_id === mg.id) {
        console.log(`OK:destination ${localName} → ${mg.id}`);
        continue;
      }
      if (byName && byName.target_id !== mg.id) {
        console.warn(`WARN: local_name ${localName} already points elsewhere (${byName.target_id})`);
        continue;
      }
      // First alias creates the target row; further aliases are extra local names.
      if (dryRun) {
        console.log(`DRY:destination ${localName} → ${mg.id}`);
      } else {
        createDestination({
          agent_group_id: ag.id,
          local_name: localName,
          target_type: 'channel',
          target_id: mg.id,
          created_at: new Date().toISOString(),
        });
        console.log(`OK:created destination ${localName}${byTarget ? ' (alias)' : ''}`);
      }
    }
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

  if (!dryRun) {
    await ensureBotInChannel();
  }

  closeDb();
  console.log(`DONE${dryRun ? ' (dry-run)' : ''}`);
  console.log('Silas can send from any session via:');
  console.log('  send_message({ to: "sysops", text: "..." })');
  console.log('  <message to="sysops">...</message>');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
