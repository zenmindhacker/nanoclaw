import { pingCliAgent } from '../../../setup/lib/agent-ping.js';
import { UPGRADE_TEST_PREFIX } from '../manifest.js';
import type { RunContext } from '../types.js';
import { CAPABILITY_PROMPT, scoreCapabilityReply } from '../utils/capability-score.js';
import { seedUpgradeTestFact } from './memory.js';
import { timedCheck } from '../report.js';
import type { CheckResult } from '../types.js';
import { runPnpmChat } from '../utils/exec.js';

export async function runCliScenarioChecks(ctx: RunContext): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  checks.push(
    await timedCheck('cli.ping', 2, async () => {
      const result = await pingCliAgent(130_000);
      if (result === 'ok') return { status: 'pass', message: 'CLI ping replied' };
      if (result === 'socket_error') {
        return {
          status: 'fail',
          message: 'CLI socket unreachable — run init-cli-agent and ensure host is up',
        };
      }
      if (result === 'auth_error') {
        return { status: 'fail', message: 'Provider auth error on CLI ping' };
      }
      return { status: 'fail', message: 'CLI ping timed out with no reply' };
    }),
  );

  if (checks.some((c) => c.id === 'cli.ping' && c.status === 'fail')) {
    checks.push({
      id: 'cli.scenarios',
      tier: 2,
      status: 'skip',
      ms: 0,
      message: 'Skipped remaining CLI scenarios — ping failed',
    });
    return checks;
  }

  checks.push(seedUpgradeTestFact(ctx));

  checks.push(
    await timedCheck('mnemon.recall-cli', 2, async () => {
      const prompt = `Run mnemon recall '${UPGRADE_TEST_PREFIX}' and quote the result verbatim. Reply in one message only.`;
      const r = runPnpmChat(prompt);
      const combined = `${r.stdout}\n${r.stderr}`;
      if (r.ok && combined.includes(UPGRADE_TEST_PREFIX) && combined.includes(ctx.upgradeTestTag)) {
        return { status: 'pass', message: 'Explicit mnemon recall via agent' };
      }
      return {
        status: 'fail',
        message: 'Agent did not return seeded upgrade test fact',
        detail: combined.slice(0, 500),
      };
    }),
  );

  checks.push(
    await timedCheck('mnemon.injection', 2, async () => {
      const prompt = `What do you know about ${UPGRADE_TEST_PREFIX}? Answer briefly from memory only.`;
      const r = runPnpmChat(prompt);
      const combined = `${r.stdout}\n${r.stderr}`;
      if (combined.includes(ctx.upgradeTestTag) || combined.includes(UPGRADE_TEST_PREFIX)) {
        return { status: 'pass', message: 'Injected mnemon context surfaced in reply' };
      }
      return {
        status: 'warn',
        message: 'Reply did not mention seeded fact — injection may be weak or LLM skipped it',
        detail: combined.slice(0, 500),
      };
    }),
  );

  checks.push(
    await timedCheck('wiki.query', 2, async () => {
      const prompt = 'Read /workspace/global/wiki/index.md (or wiki/index.md via global mount) and list the category headings defined there. Reply with the category names only.';
      const r = runPnpmChat(prompt);
      const combined = `${r.stdout}\n${r.stderr}`.toLowerCase();
      const hit = ctx.manifest.wikiCategoryHints.some((hint) => combined.includes(hint.toLowerCase()));
      if (hit) return { status: 'pass', message: 'Wiki categories referenced in reply' };
      return {
        status: 'fail',
        message: 'Reply did not mention expected wiki categories',
        detail: `Expected one of: ${ctx.manifest.wikiCategoryHints.join(', ')}`,
      };
    }),
  );

  checks.push(
    await timedCheck('skills.catalog-cli', 2, async () => {
      const prompt =
        ctx.agent === 'cleo'
          ? 'I need to search meeting transcripts from Shadow. Which skill handles that? Name it only.'
          : 'Show my grocery lists. Which skill or tool do you use? Name it only.';
      const expected = ctx.agent === 'cleo' ? 'transcript-search' : 'anylist';
      const r = runPnpmChat(prompt);
      const combined = `${r.stdout}\n${r.stderr}`.toLowerCase();
      if (combined.includes(expected)) {
        return { status: 'pass', message: `Agent referenced ${expected}` };
      }
      return {
        status: 'warn',
        message: `Agent reply did not mention ${expected}`,
        detail: combined.slice(0, 400),
      };
    }),
  );

  checks.push(
    await timedCheck('memory.capabilities-cli', 2, async () => {
      const r = runPnpmChat(CAPABILITY_PROMPT);
      const combined = `${r.stdout}\n${r.stderr}`.trim();
      if (!combined) {
        return { status: 'fail', message: 'Empty CLI reply', detail: r.stderr.slice(0, 300) };
      }
      const score = scoreCapabilityReply(combined);
      if (score === 'pass') {
        return { status: 'pass', message: 'Agent acknowledged persistent memory layers' };
      }
      if (score === 'fail') {
        return {
          status: 'fail',
          message: 'Agent denied persistent memory (generic disclaimer)',
          detail: combined.slice(0, 400),
        };
      }
      return {
        status: 'warn',
        message: 'Ambiguous capability reply — review manually',
        detail: combined.slice(0, 400),
      };
    }),
  );

  return checks;
}
