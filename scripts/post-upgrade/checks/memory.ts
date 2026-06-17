import fs from 'fs';
import path from 'path';

import { agentGlobalWikiDir } from '../../../src/agent-global.js';
import { getDb, hasTable } from '../../../src/db/connection.js';
import { auditGroupSkills } from '../../../src/modules/skills/audit.js';
import { buildCatalogForQuery } from '../../../src/modules/skills/catalog.js';
import { scanForInjection } from '../../../src/modules/skills/injection-scan.js';
import type { RunContext } from '../types.js';
import { syncTimedCheck } from '../report.js';
import type { CheckResult } from '../types.js';
import {
  execInContainer,
  execMnemonOnHost,
  findRunningContainer,
  mnemonGuidePath,
} from '../utils/container.js';

export async function runMemoryChecks(ctx: RunContext): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const container = ctx.containerName ?? findRunningContainer(ctx.agentGroupFolder);

  checks.push(
    syncTimedCheck('mnemon.dockerfile', 1, () => {
      const dockerfile = fs.readFileSync(path.join(process.cwd(), 'container', 'Dockerfile'), 'utf8');
      if (!/ARG\s+MNEMON_VERSION/.test(dockerfile) || !/ENV\s+MNEMON_DATA_DIR=/.test(dockerfile)) {
        return { status: 'fail', message: 'Mnemon not configured in container/Dockerfile' };
      }
      return { status: 'pass' };
    }),
  );

  checks.push(
    syncTimedCheck('mnemon.entrypoint', 1, () => {
      const entry = fs.readFileSync(path.join(process.cwd(), 'container', 'entrypoint.sh'), 'utf8');
      if (!entry.includes('mnemon setup')) {
        return { status: 'fail', message: 'entrypoint.sh missing mnemon setup' };
      }
      return { status: 'pass' };
    }),
  );

  checks.push(
    syncTimedCheck('mnemon.guide', 1, () => {
      const guide = mnemonGuidePath(ctx.agentGroupId);
      if (fs.existsSync(guide)) {
        return { status: 'pass', message: guide };
      }
      return { status: 'warn', message: 'guide.md not on host yet — container may create on first spawn', detail: guide };
    }),
  );

  checks.push(
    syncTimedCheck('mnemon.binary', 1, () => {
      if (container) {
        const r = execInContainer(container, 'command -v mnemon && mnemon --help >/dev/null 2>&1 && echo ok');
        if (r.ok) return { status: 'pass', message: 'mnemon in running container' };
        return { status: 'fail', message: 'mnemon missing in container', detail: r.stderr };
      }
      const r = execMnemonOnHost(ctx.agentGroupId, 'command -v mnemon && echo ok');
      if (r.ok) return { status: 'pass', message: 'mnemon in agent image' };
      return { status: 'fail', message: 'mnemon binary not found', detail: r.stderr };
    }),
  );

  checks.push(
    syncTimedCheck('mnemon.status', 1, () => {
      const run = container
        ? execInContainer(container, 'mnemon status')
        : execMnemonOnHost(ctx.agentGroupId, 'mnemon status');
      if (run.ok) return { status: 'pass', message: run.stdout.slice(0, 300) };
      return { status: 'fail', message: 'mnemon status failed', detail: run.stderr || run.stdout };
    }),
  );

  checks.push(
    syncTimedCheck('mnemon.recall', 1, () => {
      const run = container
        ? execInContainer(container, 'mnemon recall "."')
        : execMnemonOnHost(ctx.agentGroupId, 'mnemon recall "."');
      if (run.ok) return { status: 'pass', message: 'recall exited 0' };
      return { status: 'fail', message: 'mnemon recall failed', detail: run.stderr || run.stdout };
    }),
  );

  checks.push(
    syncTimedCheck('wiki.structure', 1, () => {
      const wikiRoot = agentGlobalWikiDir();
      const required = ['index.md', 'log.md', 'sources'];
      const missing = required.filter((p) => !fs.existsSync(path.join(wikiRoot, p)));
      if (missing.length > 0) {
        return { status: 'fail', message: `Wiki missing: ${missing.join(', ')}`, detail: wikiRoot };
      }
      return { status: 'pass', message: wikiRoot };
    }),
  );

  checks.push(
    syncTimedCheck('wiki.skill-doc', 1, () => {
      const skillDoc = path.join(process.cwd(), 'container', 'skills', 'wiki', 'SKILL.md');
      if (!fs.existsSync(skillDoc)) {
        return { status: 'fail', message: 'container/skills/wiki/SKILL.md missing' };
      }
      return { status: 'pass' };
    }),
  );

  checks.push(
    syncTimedCheck('skills.audit', 1, () => {
      const result = auditGroupSkills(ctx.agentGroupId, ctx.agentGroupFolder);
      if (result.issues.length > 0) {
        return {
          status: 'warn',
          message: `${result.issues.length} audit warning(s)`,
          detail: result.issues.map((i) => `${i.skill}: ${i.issue}`).join('; '),
        };
      }
      return { status: 'pass', message: `${result.totalSkills} skill(s) audited` };
    }),
  );

  checks.push(
    syncTimedCheck('skills.activation-table', 1, () => {
      if (!hasTable(getDb(), 'skill_activation_logs')) {
        return { status: 'fail', message: 'skill_activation_logs table missing (migration 016?)' };
      }
      const row = getDb().prepare('SELECT COUNT(*) AS n FROM skill_activation_logs').get() as { n: number };
      return { status: 'pass', message: `${row.n} activation log row(s)` };
    }),
  );

  checks.push(
    syncTimedCheck('skills.catalog', 1, () => {
      const query = ctx.agent === 'cleo' ? 'find meeting transcripts about ganttsy planning' : 'show my grocery lists';
      const skills = [
        { name: 'transcript-search', description: 'Search meeting transcripts from Shadow SQLite', source: 'human' },
        { name: 'anylist', description: 'AnyList grocery lists', source: 'human' },
        { name: 'todoist', description: 'Todoist tasks', source: 'human' },
      ];
      const result = buildCatalogForQuery(skills, query, 3);
      const expected = ctx.agent === 'cleo' ? 'transcript-search' : 'anylist';
      const hit =
        result.inlined.some(({ skill }) => skill.name === expected) ||
        result.compact.some((s) => s.name === expected);
      if (!hit) {
        return { status: 'fail', message: `Catalog did not rank ${expected} for query`, detail: JSON.stringify(result) };
      }
      return { status: 'pass', message: `${expected} in top-K for "${query}"` };
    }),
  );

  checks.push(
    syncTimedCheck('skills.injection-scan', 1, () => {
      const sample = fs.readFileSync(path.join(process.cwd(), 'container', 'skills', 'mnemon', 'SKILL.md'), 'utf8');
      const scan = scanForInjection(sample);
      if (!scan.ok) {
        return { status: 'fail', message: 'Benign mnemon SKILL.md flagged by injection scan', detail: scan.reason };
      }
      return { status: 'pass' };
    }),
  );

  return checks;
}
