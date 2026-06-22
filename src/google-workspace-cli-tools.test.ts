/**
 * Guard: Google Workspace CLIs/MCPs are installed via container/cli-tools.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'container/cli-tools.json'), 'utf8')) as Array<{
  name: string;
  version: string;
}>;

const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

describe('container/cli-tools.json Google Workspace install', () => {
  const entries = {
    calendar: manifest.find((t) => t.name === '@cocal/google-calendar-mcp'),
    gmail: manifest.find((t) => t.name === '@gongrzhe/server-gmail-autoauth-mcp'),
    gws: manifest.find((t) => t.name === '@googleworkspace/cli'),
    zod: manifest.find((t) => t.name === 'zod-to-json-schema'),
  };

  it('includes calendar, gmail, gws, and zod-to-json-schema pin', () => {
    expect(entries.calendar).toBeDefined();
    expect(entries.gmail).toBeDefined();
    expect(entries.gws).toBeDefined();
    expect(entries.zod).toBeDefined();
  });

  it('pins exact semver versions', () => {
    for (const entry of Object.values(entries)) {
      expect(entry?.version).toMatch(semver);
    }
  });

  it('pins expected versions', () => {
    expect(entries.calendar?.version).toBe('2.6.1');
    expect(entries.gmail?.version).toBe('1.1.11');
    expect(entries.gws?.version).toBe('0.22.5');
    expect(entries.zod?.version).toBe('3.22.5');
  });
});
