import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { tmpRoot, globalDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require('node:path') as typeof import('node:path');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require('node:os') as typeof import('node:os');
  const root = nodePath.join(nodeOs.tmpdir(), `nanoclaw-fixture-test-${process.pid}`);
  const gDir = nodePath.join(root, 'groups', 'global');
  return { tmpRoot: root, globalDir: gDir };
});

vi.mock('../../../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/config.js')>('../../../src/config.js');
  return {
    ...actual,
    GROUPS_DIR: path.join(tmpRoot, 'groups'),
  };
});

vi.mock('../../../src/agent-global.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/agent-global.js')>(
    '../../../src/agent-global.js',
  );
  return {
    ...actual,
    agentGlobalDir: () => globalDir,
    agentGlobalWikiDir: () => path.join(globalDir, 'wiki'),
    agentGlobalMnemonDir: () => path.join(globalDir, 'mnemon'),
  };
});

import {
  createMemoryFixture,
  replyContainsFixture,
  seedLocalFixture,
  seedThreadHistoryFixture,
  seedWikiFixture,
} from './memory-fixtures.js';
import type { RunContext } from '../types.js';

const ctx = {
  agent: 'cleo',
  agentGroupFolder: 'dm-with-cian',
  agentGroupId: 'ag-test',
} as RunContext;

beforeEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpRoot, 'groups', 'global', 'wiki'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRoot, 'groups', 'global', 'wiki', 'index.md'),
    '# Wiki Index\n\n| Page | Summary | Updated |\n|------|---------|--------|\n| *(empty — first ingest will populate this)* | | |\n',
  );
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('memory fixtures', () => {
  it('createMemoryFixture produces unique tokens', () => {
    const a = createMemoryFixture({ ...ctx, upgradeTestTag: '2026-06-17' } as RunContext);
    const b = createMemoryFixture({ ...ctx, upgradeTestTag: '2026-06-17' } as RunContext);
    expect(a.token).not.toBe(b.token);
    expect(a.projectName).toContain('Zephyr-');
  });

  it('seedWikiFixture writes a retrievable page', () => {
    const fixture = createMemoryFixture({ ...ctx, upgradeTestTag: 't' } as RunContext);
    seedWikiFixture(ctx, fixture);
    const page = fs.readFileSync(
      path.join(tmpRoot, 'groups', 'global', 'wiki', 'pages', `harness-${fixture.nonce}.md`),
      'utf8',
    );
    expect(page).toContain(fixture.token);
    expect(page).toContain(fixture.blocker);
  });

  it('seedLocalFixture writes marked block', () => {
    const fixture = createMemoryFixture({ ...ctx, upgradeTestTag: 't' } as RunContext);
    seedLocalFixture(ctx, fixture);
    const local = fs.readFileSync(path.join(tmpRoot, 'groups', 'global', 'CLAUDE.local.md'), 'utf8');
    expect(local).toContain(fixture.token);
  });

  it('seedThreadHistoryFixture writes slack_history.json', () => {
    const fixture = createMemoryFixture({ ...ctx, upgradeTestTag: 't' } as RunContext);
    seedThreadHistoryFixture(ctx, fixture);
    const history = JSON.parse(
      fs.readFileSync(path.join(tmpRoot, 'groups', 'dm-with-cian', 'slack_history.json'), 'utf8'),
    ) as Array<{ text: string }>;
    expect(history[0].text).toContain(fixture.token);
  });

  it('replyContainsFixture matches blocker or token', () => {
    const fixture = createMemoryFixture({ ...ctx, upgradeTestTag: 't' } as RunContext);
    expect(replyContainsFixture(`Status: ${fixture.blocker}`, fixture)).toBe(true);
    expect(replyContainsFixture('nothing relevant', fixture)).toBe(false);
  });
});
