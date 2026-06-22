/**
 * Guard: @cocal/google-calendar-mcp is installed via container/cli-tools.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'container/cli-tools.json'), 'utf8')) as Array<{
  name: string;
  version: string;
}>;

describe('container/cli-tools.json google-calendar-mcp install', () => {
  const entry = manifest.find((t) => t.name === '@cocal/google-calendar-mcp');

  it('includes @cocal/google-calendar-mcp', () => {
    expect(entry).toBeDefined();
  });

  it('pins an exact semver', () => {
    expect(entry?.version).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });
});
