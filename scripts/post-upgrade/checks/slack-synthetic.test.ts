import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

describe('post-upgrade slack history checks', () => {
  it('history-sync uses form-encoded Slack API bodies', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/extensions/slack/history-sync.ts'), 'utf8');
    expect(src).toContain('application/x-www-form-urlencoded');
    expect(src).toContain('URLSearchParams');
  });

  it('history-sync-hooks registers inbound pre-route hook', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/extensions/slack/history-sync-hooks.ts'),
      'utf8',
    );
    expect(src).toContain('registerInboundPreRouteHook');
    expect(src).toContain('syncSlackInboundPreRoute');
  });

  it('search_slack_history MCP tool and instructions exist', () => {
    const mcp = fs.readFileSync(
      path.join(process.cwd(), 'container/agent-runner/src/extensions/slack/search-history.ts'),
      'utf8',
    );
    expect(mcp).toContain("name: 'search_slack_history'");
    expect(fs.existsSync(
      path.join(process.cwd(), 'container/agent-runner/src/extensions/slack/search-history.instructions.md'),
    )).toBe(true);
  });
});
