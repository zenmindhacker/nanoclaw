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
import {
  countOutboundChat,
  pollOutboundForFixture,
  resolveCliSession,
  waitForGroupContainersIdle,
} from '../utils/cli-session.js';
import { runPnpmChat } from '../utils/exec.js';

/** CLI socket wait per question (chat.ts reads CHAT_TIMEOUT_MS). */
const CHAT_TURN_MS = 180_000;
/** Poll outbound.db after CLI returns if socket missed delivery. */
const OUTBOUND_POLL_MS = 45_000;
/** Max wait for a stuck container to exit before sending the next prompt. */
const IDLE_WAIT_MS = 90_000;

async function askAgent(
  ctx: RunContext,
  prompt: string,
  fixture: MemoryFixture,
): Promise<{ ok: boolean; text: string; via: 'cli' | 'outbound' | 'none' }> {
  const session = resolveCliSession(ctx);
  if (!session) {
    return { ok: false, text: '', via: 'none' };
  }

  await waitForGroupContainersIdle(ctx.agentGroupFolder, IDLE_WAIT_MS);
  const outboundBefore = countOutboundChat(ctx.agentGroupId, session.id);

  const r = runPnpmChat(prompt, CHAT_TURN_MS + 15_000, CHAT_TURN_MS);
  const cliText = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();

  if (replyContainsFixture(cliText, fixture)) {
    return { ok: r.ok || replyContainsFixture(cliText, fixture), text: cliText, via: 'cli' };
  }

  const outboundText = await pollOutboundForFixture(
    ctx.agentGroupId,
    session.id,
    fixture,
    outboundBefore,
    OUTBOUND_POLL_MS,
  );
  if (outboundText) {
    return { ok: true, text: outboundText, via: 'outbound' };
  }

  if (cliText.includes('timeout: no reply')) {
    return {
      ok: false,
      text: cliText + `\n(no matching outbound within ${OUTBOUND_POLL_MS / 1000}s after CLI timeout)`,
      via: 'none',
    };
  }

  return { ok: r.ok, text: cliText || '(empty)', via: 'none' };
}

function recallCheck(
  id: string,
  fixture: MemoryFixture,
  result: { ok: boolean; text: string; via: 'cli' | 'outbound' | 'none' },
  passMessage: string,
): CheckResult {
  if (!result.text || result.via === 'none') {
    const timedOut = result.text.includes('timeout: no reply');
    return {
      id,
      tier: 2,
      status: 'fail',
      ms: 0,
      message: timedOut ? 'Agent reply not delivered to CLI in time' : 'Empty agent reply',
      detail: result.text.slice(0, 500) || 'Is nanoclaw running? Run: pnpm exec tsx scripts/wire-cli-primary.ts --agent cleo|silas',
    };
  }
  if (replyContainsFixture(result.text, fixture)) {
    const via = result.via === 'outbound' ? ' (via outbound.db — CLI socket missed delivery)' : '';
    return { id, tier: 2, status: 'pass', ms: 0, message: passMessage + via };
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
      const result = await pingCliAgent(CHAT_TURN_MS + 15_000, CHAT_TURN_MS);
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
      const result = await askAgent(ctx, `What do you remember about ${fixture.projectName}? One sentence.`, fixture);
      return recallCheck('memory.mnemon-recall', fixture, result, 'Recalled mnemon-seeded fact via CLI');
    }),
  );

  checks.push(
    await timedCheck('memory.wiki-recall', 2, async () => {
      seedWikiFixture(ctx, fixture);
      const result = await askAgent(
        ctx,
        `Look up ${fixture.projectName} in the wiki and tell me what the blocker was. One sentence.`,
        fixture,
      );
      const check = recallCheck('memory.wiki-recall', fixture, result, 'Recalled wiki-seeded fact via CLI');
      cleanupWikiFixture(fixture);
      return check;
    }),
  );

  checks.push(
    await timedCheck('memory.local-recall', 2, async () => {
      seedLocalFixture(ctx, fixture);
      const result = await askAgent(
        ctx,
        `Check your agent-wide notes for ${fixture.projectName}. What was the blocker? One sentence.`,
        fixture,
      );
      const check = recallCheck(
        'memory.local-recall',
        fixture,
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
        ctx,
        `We discussed ${fixture.projectName} in a sysops thread earlier. What was the blocker? One sentence.`,
        fixture,
      );
      const check = recallCheck(
        'memory.thread-recall',
        fixture,
        result,
        'Recalled slack_history.json thread context via CLI',
      );
      cleanupThreadHistoryFixture(ctx);
      return check;
    }),
  );

  checks.push(
    await timedCheck('skills.catalog-cli', 2, async () => {
      await waitForGroupContainersIdle(ctx.agentGroupFolder, IDLE_WAIT_MS);
      const prompt =
        ctx.agent === 'cleo'
          ? 'I need to search meeting transcripts from Shadow. Which skill handles that? Name it only.'
          : 'Show my grocery lists. Which skill or tool do you use? Name it only.';
      const expected = ctx.agent === 'cleo' ? 'transcript-search' : 'anylist';
      const r = runPnpmChat(prompt, CHAT_TURN_MS + 15_000, CHAT_TURN_MS);
      const combined = [r.stdout, r.stderr].filter(Boolean).join('\n').toLowerCase();
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

  return checks;
}
