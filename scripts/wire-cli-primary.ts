/**
 * Wire the local CLI channel to the production primary agent group.
 *
 * Use this before `pnpm run chat` or `pnpm run test:capabilities` so behavioral
 * smoke tests hit Cleo/Silas persona + provider, not a scratch smoke agent.
 *
 * Usage:
 *   pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo
 *   pnpm exec tsx scripts/wire-cli-primary.ts --agent silas
 */
import path from 'path';

import { getAgentGroupByFolder } from '../src/db/agent-groups.js';
import { initDb } from '../src/db/connection.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  deleteMessagingGroupAgent,
  getMessagingGroupAgents,
  getMessagingGroupByPlatform,
} from '../src/db/messaging-groups.js';
import { runMigrations } from '../src/db/migrations/index.js';
import { upsertUser } from '../src/modules/permissions/db/users.js';
import { DATA_DIR } from '../src/config.js';
import { getManifest, parseAgentName } from './post-upgrade/manifest.js';

const CLI_CHANNEL = 'cli';
const CLI_PLATFORM_ID = 'local';
const CLI_USER_ID = `${CLI_CHANNEL}:${CLI_PLATFORM_ID}`;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseArgs(argv: string[]): { agent: 'cleo' | 'silas' } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent' && argv[i + 1]) {
      const agent = parseAgentName(argv[i + 1]);
      if (!agent) {
        console.error(`Unknown agent: ${argv[i + 1]} (expected cleo or silas)`);
        process.exit(2);
      }
      return { agent };
    }
  }
  console.error('Usage: pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo|silas');
  process.exit(2);
}

async function main(): Promise<void> {
  const { agent } = parseArgs(process.argv.slice(2));
  const manifest = getManifest(agent);
  const now = new Date().toISOString();

  const db = initDb(path.join(DATA_DIR, 'v2.db'));
  runMigrations(db);

  const ag = getAgentGroupByFolder(manifest.primaryGroupFolder);
  if (!ag) {
    console.error(`Agent group folder not found: ${manifest.primaryGroupFolder}`);
    process.exit(1);
  }

  upsertUser({
    id: CLI_USER_ID,
    kind: CLI_CHANNEL,
    display_name: agent === 'cleo' ? 'Cian' : 'Christina',
    created_at: now,
  });

  let cliMg = getMessagingGroupByPlatform(CLI_CHANNEL, CLI_PLATFORM_ID);
  if (!cliMg) {
    cliMg = {
      id: generateId('mg'),
      channel_type: CLI_CHANNEL,
      platform_id: CLI_PLATFORM_ID,
      name: 'Local CLI',
      is_group: 0,
      unknown_sender_policy: 'public',
      created_at: now,
    };
    createMessagingGroup(cliMg);
    console.log(`Created CLI messaging group: ${cliMg.id}`);
  }

  for (const wiring of getMessagingGroupAgents(cliMg.id)) {
    if (wiring.agent_group_id !== ag.id) {
      deleteMessagingGroupAgent(wiring.id);
      console.log(`Removed CLI wiring for other agent: ${wiring.agent_group_id}`);
    }
  }

  const existing = getMessagingGroupAgents(cliMg.id).find((w) => w.agent_group_id === ag.id);
  if (!existing) {
    createMessagingGroupAgent({
      id: generateId('mga'),
      messaging_group_id: cliMg.id,
      agent_group_id: ag.id,
      engage_mode: 'pattern',
      engage_pattern: '.',
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'shared',
      priority: 100,
      created_at: now,
    });
    console.log(`Wired CLI -> ${ag.name} (${manifest.primaryGroupFolder})`);
  } else {
    console.log(`CLI already wired -> ${ag.name} (${manifest.primaryGroupFolder})`);
  }

  console.log('');
  console.log('Try:');
  console.log('  pnpm run test:capabilities');
  console.log('  pnpm run chat "Do you have persistent memory? One sentence."');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
