import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../../../src/config.js';
import type { RunContext } from '../types.js';
import { syncTimedCheck } from '../report.js';
import type { CheckResult } from '../types.js';

const CONTAINER_CLAUDE = path.join(process.cwd(), 'container', 'CLAUDE.md');
const WIKI_SKILL = path.join(process.cwd(), 'container', 'skills', 'wiki', 'SKILL.md');

export function runCompositionChecks(ctx: RunContext): CheckResult[] {
  const checks: CheckResult[] = [];

  checks.push(
    syncTimedCheck('composed-claude-imports', 1, () => {
      const claudeMd = path.join(GROUPS_DIR, ctx.agentGroupFolder, 'CLAUDE.md');
      if (!fs.existsSync(claudeMd)) {
        return {
          status: 'warn',
          message: `Composed CLAUDE.md missing (spawn regenerates): ${claudeMd}`,
        };
      }
      const content = fs.readFileSync(claudeMd, 'utf8');
      if (content.includes('@./.claude-global.md')) {
        return { status: 'fail', message: 'Stale @./.claude-global.md import in composed CLAUDE.md' };
      }
      if (!content.includes('@./.claude-shared.md')) {
        return { status: 'fail', message: 'Missing @./.claude-shared.md in composed CLAUDE.md' };
      }
      const globalPersona = path.join(GROUPS_DIR, 'global', 'CLAUDE.md');
      if (fs.existsSync(globalPersona) && !content.includes('@../global/CLAUDE.md')) {
        return { status: 'warn', message: 'Global persona exists but not imported in composed CLAUDE.md' };
      }
      return { status: 'pass', message: claudeMd };
    }),
  );

  checks.push(
    syncTimedCheck('container-base-persistence', 1, () => {
      if (!fs.existsSync(CONTAINER_CLAUDE)) {
        return { status: 'fail', message: `Missing ${CONTAINER_CLAUDE}` };
      }
      const content = fs.readFileSync(CONTAINER_CLAUDE, 'utf8');
      if (!content.includes('SAVE IMMEDIATELY')) {
        return { status: 'fail', message: 'container/CLAUDE.md missing SAVE IMMEDIATELY persistence rule' };
      }
      if (!content.includes('/workspace/global/')) {
        return { status: 'fail', message: 'container/CLAUDE.md missing /workspace/global/ memory paths' };
      }
      return { status: 'pass' };
    }),
  );

  checks.push(
    syncTimedCheck('global-memory-scaffold', 1, () => {
      const globalDir = path.join(GROUPS_DIR, 'global');
      const wikiDir = path.join(globalDir, 'wiki');
      const mnemonDir = path.join(globalDir, 'mnemon');
      const missing: string[] = [];
      if (!fs.existsSync(globalDir)) missing.push(globalDir);
      if (!fs.existsSync(wikiDir)) missing.push(wikiDir);
      if (!fs.existsSync(mnemonDir)) missing.push(mnemonDir);
      if (missing.length > 0) {
        return {
          status: 'warn',
          message: 'Global memory scaffold incomplete',
          detail: missing.join(', '),
        };
      }
      return { status: 'pass', message: globalDir };
    }),
  );

  checks.push(
    syncTimedCheck('stream-progress-fragment', 1, () => {
      const fragment = path.join(
        GROUPS_DIR,
        ctx.agentGroupFolder,
        '.claude-fragments',
        'module-stream-progress.md',
      );
      const source = path.join(
        process.cwd(),
        'container',
        'agent-runner',
        'src',
        'extensions',
        'slack',
        'stream-progress.instructions.md',
      );
      if (!fs.existsSync(source)) {
        return { status: 'warn', message: 'stream-progress extension source missing (fork-only)' };
      }
      if (!fs.existsSync(fragment)) {
        return {
          status: 'warn',
          message: 'module-stream-progress fragment missing (regenerated on container spawn)',
        };
      }
      return { status: 'pass' };
    }),
  );

  checks.push(
    syncTimedCheck('wiki-skill-paths', 1, () => {
      if (!fs.existsSync(WIKI_SKILL)) {
        return { status: 'fail', message: 'container/skills/wiki/SKILL.md missing' };
      }
      const content = fs.readFileSync(WIKI_SKILL, 'utf8');
      if (!content.includes('/workspace/global/wiki/')) {
        return { status: 'fail', message: 'wiki SKILL.md does not reference /workspace/global/wiki/' };
      }
      return { status: 'pass' };
    }),
  );

  return checks;
}
