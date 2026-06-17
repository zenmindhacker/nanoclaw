/**
 * Behavioral smoke: agent acknowledges persistent memory via CLI.
 *
 * Requires:
 *   - nanoclaw host service running
 *   - CLI wired to production group: pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo
 *
 * Usage:
 *   pnpm run test:capabilities
 *   pnpm run test:capabilities -- --agent silas
 */
import { CAPABILITY_PROMPT, scoreCapabilityReply } from './post-upgrade/utils/capability-score.js';
import { parseAgentName } from './post-upgrade/manifest.js';
import { runPnpmChat } from './post-upgrade/utils/exec.js';

function parseArgs(argv: string[]): { agent: string | null } {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agent' && argv[i + 1]) {
      return { agent: argv[i + 1] };
    }
  }
  return { agent: null };
}

function main(): void {
  const { agent } = parseArgs(process.argv.slice(2));
  if (agent && !parseAgentName(agent)) {
    console.error(`Unknown --agent ${agent} (expected cleo or silas)`);
    process.exit(2);
  }

  console.error(`Prompt: ${CAPABILITY_PROMPT}`);
  console.error('Waiting for agent reply via CLI...\n');

  const r = runPnpmChat(CAPABILITY_PROMPT);
  const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();

  if (!r.ok && !combined) {
    console.error('CLI chat failed. Is nanoclaw running? Is CLI wired?');
    console.error('  pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo');
    process.exit(2);
  }

  if (r.stdout) console.log(r.stdout);

  const score = scoreCapabilityReply(combined);
  console.error(`\nScore: ${score}`);

  if (score === 'fail') {
    console.error('Agent denied persistent memory without acknowledging save layers.');
    process.exit(1);
  }
  if (score === 'warn') {
    console.error('Ambiguous reply — review manually.');
    process.exit(0);
  }
  process.exit(0);
}

main();
