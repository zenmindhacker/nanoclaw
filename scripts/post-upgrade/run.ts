/**
 * Post-upgrade verification harness for Cleo / Silas production installs.
 *
 * Usage:
 *   pnpm run post-upgrade -- --agent cleo --tier 1,2 --json-out /tmp/report.json
 *
 * Prerequisites:
 *   - NanoClaw host service running on this machine
 *   - CLI agent wired: pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo|silas
 *   - For Tier 2 Slack synthetic: active session on a wired Slack messaging group
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../../src/config.js';
import { initDb } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations/index.js';
import { getAgentGroupByFolder } from '../../src/db/agent-groups.js';
import { findSessionByAgentGroup } from '../../src/db/sessions.js';
import { runCliScenarioChecks } from './checks/cli-scenarios.js';
import { runCompositionChecks } from './checks/composition.js';
import { runHostChecks } from './checks/host.js';
import { runSilasInfraChecks } from './checks/silas-infra.js';
import { runMemoryChecks } from './checks/memory.js';
import { runSkillsReadonlyChecks } from './checks/skills-readonly.js';
import { runSlackSyntheticChecks } from './checks/slack-synthetic.js';
import { getManifest, parseAgentName } from './manifest.js';
import { buildReport, hasTierFailures, printReport } from './report.js';
import type { AgentName, CheckResult } from './types.js';
import { findRunningContainer } from './utils/container.js';
import { gitCommit } from './utils/exec.js';

function parseArgs(argv: string[]): {
  agent: AgentName;
  tiers: Set<1 | 2>;
  jsonOut?: string;
  skipTier2OnFail: boolean;
} {
  let agent: AgentName | null = null;
  const tiers = new Set<1 | 2>();
  let jsonOut: string | undefined;
  let skipTier2OnFail = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--agent' && argv[i + 1]) {
      agent = parseAgentName(argv[++i]);
    } else if (arg === '--tier' && argv[i + 1]) {
      for (const t of argv[++i].split(',')) {
        if (t === '1') tiers.add(1);
        if (t === '2') tiers.add(2);
      }
    } else if (arg === '--json-out' && argv[i + 1]) {
      jsonOut = argv[++i];
    } else if (arg === '--force-tier2') {
      skipTier2OnFail = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: pnpm run post-upgrade -- --agent cleo|silas [--tier 1,2] [--json-out path] [--force-tier2]`);
      process.exit(0);
    }
  }

  if (!agent) {
    console.error('Missing required --agent cleo|silas');
    process.exit(2);
  }
  if (tiers.size === 0) {
    tiers.add(1);
    tiers.add(2);
  }

  return { agent, tiers, jsonOut, skipTier2OnFail };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = getManifest(args.agent);
  const startedAt = new Date().toISOString();

  const dbPath = path.join(DATA_DIR, 'v2.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`Central DB not found at ${dbPath}`);
    process.exit(2);
  }

  const db = initDb(dbPath);
  runMigrations(db);

  const group = getAgentGroupByFolder(manifest.primaryGroupFolder);
  if (!group) {
    console.error(`Agent group folder not found in DB: ${manifest.primaryGroupFolder}`);
    process.exit(2);
  }

  const session = findSessionByAgentGroup(group.id);
  const containerName = findRunningContainer(group.folder);
  const upgradeTestTag = new Date().toISOString().slice(0, 10);

  const ctx = {
    agent: args.agent,
    manifest,
    agentGroupId: group.id,
    agentGroupFolder: group.folder,
    primarySessionId: session?.id ?? null,
    containerName,
    upgradeTestTag,
  };

  const checks: CheckResult[] = [];

  if (args.tiers.has(1)) {
    checks.push(...(await runHostChecks(ctx)));
    checks.push(...runSilasInfraChecks(ctx));
    checks.push(...runCompositionChecks(ctx));
    checks.push(...(await runMemoryChecks(ctx)));
    checks.push(...(await runSkillsReadonlyChecks(ctx)));
    checks.push(...(await runSlackSyntheticChecks(ctx, new Set([1]))));
  }

  if (args.tiers.has(2)) {
    if (args.skipTier2OnFail && hasTierFailures(checks, 1)) {
      checks.push({
        id: 'tier2',
        tier: 2,
        status: 'skip',
        ms: 0,
        message: 'Tier 2 skipped due to Tier 1 failures (use --force-tier2 to override)',
      });
    } else {
      checks.push(...(await runCliScenarioChecks(ctx)));
      checks.push(...(await runSlackSyntheticChecks(ctx, new Set([2]))));
    }
  }

  const report = buildReport({
    agent: args.agent,
    commit: gitCommit(),
    tiers: [...args.tiers].map(String),
    startedAt,
    checks,
  });

  if (args.jsonOut) {
    fs.writeFileSync(args.jsonOut, JSON.stringify(report, null, 2));
  }
  printReport(report);

  process.exit(report.summary.fail > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
