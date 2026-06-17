import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadJsonFile, searchEntries, searchSlackHistory } from './search-history.js';

describe('searchEntries', () => {
  const entries = [
    { text: 'NVS Email Processor — Error', sender: 'Cleo', timestamp: '2026-06-17T17:00:00.000Z' },
    { text: 'can you check it now?', sender: 'Cian', timestamp: '2026-06-17T17:05:00.000Z' },
    { text: 'Transcript sync failed', sender: 'Cleo', timestamp: '2026-06-17T16:00:00.000Z' },
  ];

  it('matches case-insensitively and returns the most recent hits up to limit', () => {
    const matches = searchEntries(entries, 'nvs', 10);
    expect(matches).toHaveLength(1);
    expect(matches[0].text).toContain('NVS Email Processor');
  });

  it('returns the last N matches when limit is smaller than result set', () => {
    const matches = searchEntries(entries, 'e', 2);
    expect(matches).toHaveLength(2);
    expect(matches[0].text).toContain('can you check');
    expect(matches[1].text).toContain('Transcript sync');
  });
});

describe('loadJsonFile', () => {
  it('returns an empty array for missing or invalid files', () => {
    expect(loadJsonFile('/tmp/does-not-exist-slack-history.json')).toEqual([]);
  });
});

describe('search_slack_history MCP tool', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-slack-search-'));
    process.env.NANOCLAW_AGENT_DIR = tmpDir;
    fs.writeFileSync(
      path.join(tmpDir, 'slack_history.json'),
      JSON.stringify([
        {
          text: 'invoice-generator missing from /workspace/extra/skills/',
          sender: 'Cleo',
          timestamp: '2026-06-17T17:00:00.000Z',
        },
      ]),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'slack_channel_history.json'),
      JSON.stringify([
        {
          text: 'older sibling thread about oauth-health',
          sender: 'Cleo',
          timestamp: '2026-06-17T16:00:00.000Z',
          threadId: 'slack:C07F195GB96:1781714412.715089',
        },
      ]),
    );
  });

  afterEach(() => {
    delete process.env.NANOCLAW_AGENT_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searches thread and channel export files', async () => {
    const result = await searchSlackHistory.handler({ query: 'invoice-generator' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('invoice-generator missing');
    expect(result.content[0].text).toContain('Cleo');
  });

  it('reports no matches when query is absent from exports', async () => {
    const result = await searchSlackHistory.handler({ query: 'nonexistent-token-xyz' });
    expect(result.content[0].text).toContain('No matches');
  });

  it('requires a non-empty query', async () => {
    const result = await searchSlackHistory.handler({ query: '   ' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });
});
