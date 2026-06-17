import type { AgentManifest, AgentName } from './types.js';

const MANIFESTS: Record<AgentName, AgentManifest> = {
  cleo: {
    agent: 'cleo',
    primaryGroupFolder: 'dm-with-cian',
    wikiCategoryHints: ['Infrastructure', 'Integrations', 'Workflows'],
    skillCommands: [
      {
        id: 'todoist.list',
        cmd: 'node --experimental-strip-types /workspace/extra/skills/todoist/scripts/todoist.ts list --json',
      },
      {
        id: 'linear.list',
        cmd: 'bash /workspace/extra/skills/linear/linear-router.sh cog list --json',
      },
    ],
    cleoOnly: true,
  },
  silas: {
    agent: 'silas',
    primaryGroupFolder: 'dm-with-christina',
    wikiCategoryHints: ['Cycle', 'Christina', 'Life Admin', 'Briefings'],
    skillCommands: [
      {
        id: 'anylist.list-names',
        cmd: 'node /workspace/extra/skills/anylist/cli.mjs list-names',
      },
      {
        id: 'todoist.list',
        cmd: 'node --experimental-strip-types /workspace/extra/skills/todoist/scripts/todoist.ts list --json',
      },
      {
        id: 'cycle-briefing',
        cmd: 'node /workspace/agent/cycle_briefing.mjs --task-json',
        cwd: '/workspace/agent',
      },
    ],
    silasOnly: true,
  },
};

export function getManifest(agent: AgentName): AgentManifest {
  return MANIFESTS[agent];
}

export function parseAgentName(raw: string): AgentName | null {
  if (raw === 'cleo' || raw === 'silas') return raw;
  return null;
}

/** Stable prefix for harness-written mnemon facts. */
export const UPGRADE_TEST_PREFIX = '__upgrade_test__';

/** Token expected in synthetic Slack harness replies. */
export const UPGRADE_SLACK_REPLY_TOKEN = 'UPGRADE_SLACK_OK';
