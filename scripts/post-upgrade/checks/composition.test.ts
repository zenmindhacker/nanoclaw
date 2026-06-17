import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RunContext } from '../types.js';

describe('runCompositionChecks', () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-compose-check-'));
    process.chdir(tmp);
    process.env.GROUPS_DIR = 'groups';

    fs.mkdirSync(path.join(tmp, 'container'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'container', 'CLAUDE.md'),
      'SAVE IMMEDIATELY\n/workspace/global/wiki/\n',
    );
    fs.mkdirSync(path.join(tmp, 'container', 'skills', 'wiki'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'container', 'skills', 'wiki', 'SKILL.md'),
      '# Wiki at /workspace/global/wiki/\n',
    );
    fs.mkdirSync(
      path.join(tmp, 'container', 'agent-runner', 'src', 'extensions', 'slack'),
      { recursive: true },
    );
    fs.writeFileSync(
      path.join(
        tmp,
        'container',
        'agent-runner',
        'src',
        'extensions',
        'slack',
        'stream-progress.instructions.md',
      ),
      '# stream progress\n',
    );

    const groups = path.join(tmp, 'groups', 'test-group');
    fs.mkdirSync(path.join(groups, '.claude-fragments'), { recursive: true });
    fs.writeFileSync(
      path.join(groups, 'CLAUDE.md'),
      '@./.claude-shared.md\n@../global/CLAUDE.md\n',
    );
    fs.mkdirSync(path.join(tmp, 'groups', 'global', 'wiki'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'groups', 'global', 'mnemon'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'groups', 'global', 'CLAUDE.md'), '# persona\n');
    fs.writeFileSync(
      path.join(groups, '.claude-fragments', 'module-stream-progress.md'),
      'symlink target',
    );
  });

  afterEach(() => {
    process.chdir(prevCwd);
    delete process.env.GROUPS_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const ctx: RunContext = {
    agent: 'cleo',
    manifest: {
      agent: 'cleo',
      primaryGroupFolder: 'test-group',
      wikiCategoryHints: [],
      skillCommands: [],
      cleoOnly: true,
    },
    agentGroupId: 'ag-1',
    agentGroupFolder: 'test-group',
    primarySessionId: null,
    containerName: null,
    upgradeTestTag: '2026-06-17',
  };

  it('passes composition and persistence checks in a minimal scaffold', async () => {
    const { runCompositionChecks } = await import('./composition.js');
    const results = runCompositionChecks(ctx);
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    expect(byId['container-base-persistence']).toBe('pass');
    expect(byId['wiki-skill-paths']).toBe('pass');
    expect(byId['composed-claude-imports']).toBe('pass');
    expect(byId['global-memory-scaffold']).toBe('pass');
    expect(byId['stream-progress-fragment']).toBe('pass');
  });
});
