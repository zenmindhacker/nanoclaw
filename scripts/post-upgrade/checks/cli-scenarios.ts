import { pingCliAgent } from '../../../setup/lib/agent-ping.js';
import type { RunContext } from '../types.js';
import {
  cleanupLocalFixture,
  cleanupThreadHistoryFixture,
  cleanupWikiFixture,
  createMemoryFixture,
  replyContainsFixture,
  seedLocalFixture,
  seedMnemonFixture,
  seedThreadHistoryFixture,
  seedWikiFixture,
  type MemoryFixture,
} from '../fixtures/memory-fixtures.js';
import { timedCheck } from '../report.js';
import type { CheckResult } from '../types.js';
import { runPnpmChat } from '../utils/exec.js';

async function askAgent(prompt: string): Promise<{ ok: boolean; text: string }> {
  const r = runPnpmChat(prompt);
  const text = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
  return { ok: r.ok, text };
}

function recallCheck(
  id: string,
  fixture: MemoryFixture,
  prompt: string,
  result: { ok: boolean; text: string },
  passMessage: string,
): CheckResult {
  if (!result.text) {
    return {
      id,
      tier: 2,
      status: 'fail',
      ms: 0,
      message: 'Empty CLI reply',
      detail: 'Is nanoclaw running? Run: pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo|silas',
    };
  }
  if (replyContainsFixture(result.text, fixture)) {
    return { id, tier: 2, status: 'pass', ms: 0, message: passMessage };
  }
  return {
    id,
    tier: 2,
    status: 'fail',
    ms: 0,
    message: 'Reply did not recall seeded fact',
    detail: result.text.slice(0, 500),
  };
}

export async function runCliScenarioChecks(ctx: RunContext): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  checks.push(
    await timedCheck('cli.ping', 2, async () => {
      const result = await pingCliAgent(130_000);
      if (result === 'ok') return { status: 'pass', message: 'CLI ping replied' };
      if (result === 'socket_error') {
        return {
          status: 'fail',
          message: 'CLI socket unreachable — wire CLI: pnpm exec tsx scripts/wire-cli-primary.ts --agent ' + ctx.agent,
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
      message: 'Skipped memory recall scenarios — CLI ping failed',
    });
    return checks;
  }

  const fixture = createMemoryFixture(ctx);

  checks.push(
    await timedCheck('memory.mnemon-recall', 2, async () => {
      const seed = seedMnemonFixture(ctx, fixture);
      if (!seed.ok) {
        return { status: 'fail', message: 'Failed to seed mnemon fixture', detail: seed.detail };
      }
      const result = await askAgent(`What do you remember about ${fixture.projectName}? One sentence.`);
      return recallCheck(
        'memory.mnemon-recall',
        fixture,
        '',
        result,
        'Recalled mnemon-seeded fact via CLI',
      );
    }),
  );

  checks.push(
    await timedCheck('memory.wiki-recall', 2, async () => {
      seedWikiFixture(ctx, fixture);
      const result = await askAgent(
        `Look up ${fixture.projectName} in the wiki and tell me what the blocker was. One sentence.`,
      );
      const check = recallCheck('memory.wiki-recall', fixture, '', result, 'Recalled wiki-seeded fact via CLI');
      cleanupWikiFixture(fixture);
      return check;
    }),
  );

  checks.push(
    await timedCheck('memory.local-recall', 2, async () => {
      seedLocalFixture(ctx, fixture);
      const result = await askAgent(
        `Check your agent-wide notes for ${fixture.projectName}. What was the blocker? One sentence.`,
      );
      const check = recallCheck(
        'memory.local-recall',
        fixture,
        '',
        result,
        'Recalled CLAUDE.local.md fact via CLI',
      );
      cleanupLocalFixture();
      return check;
    }),
  );

  checks.push(
    await timedCheck('memory.thread-recall', 2, async () => {
      seedThreadHistoryFixture(ctx, fixture);
      const result = await askAgent(
        `We discussed ${fixture.projectName} in a sysops thread earlier. What was the blocker? One sentence.`,
      );
      const check = recallCheck(
        'memory.thread-recall',
        fixture,
        '',
        result,
        'Recalled slack_history.json thread context via CLI',
      );
      cleanupThreadHistoryFixture(ctx);
      return check;
    }),
  );

  checks.push(
    await timedCheck('skills.catalog-cli', 2, async () => {
      const prompt =
        ctx.agent === 'cleo'
          ? 'I need to search meeting transcripts from Shadow. Which skill handles that? Name it only.'
          : 'Show my grocery lists. Which skill or tool do you use? Name it only.';
      const expected = ctx.agent === 'cleo' ? 'transcript-search' : 'anylist';
      const result = await askAgent(prompt);
      const combined = result.text.toLowerCase();
      if (combined.includes(expected)) {
        return { status: 'pass', message: `Agent referenced ${expected}` };
      }
      return {
        status: 'warn',
        message: `Agent reply did not mention ${expected}`,
        detail: result.text.slice(0, 400),
      };
    }),
  );

  return checks;
}
