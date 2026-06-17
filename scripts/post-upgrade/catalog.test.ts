import { describe, expect, it } from 'vitest';

import { buildCatalogForQuery } from '../../src/modules/skills/catalog.js';

describe('post-upgrade skills catalog smoke', () => {
  it('ranks transcript-sync for Cleo-style queries', () => {
    const skills = [
      { name: 'transcript-sync', description: 'Meeting transcript sync to Linear' },
      { name: 'anylist', description: 'AnyList grocery lists' },
      { name: 'todoist', description: 'Todoist tasks' },
    ];
    const result = buildCatalogForQuery(skills, 'sync meeting transcripts to linear', 3);
    expect(result.inlined.some(({ skill }) => skill.name === 'transcript-sync')).toBe(true);
  });

  it('ranks anylist for Silas-style queries', () => {
    const skills = [
      { name: 'transcript-sync', description: 'Meeting transcript sync to Linear' },
      { name: 'anylist', description: 'AnyList grocery lists' },
      { name: 'todoist', description: 'Todoist tasks' },
    ];
    const result = buildCatalogForQuery(skills, 'show my grocery lists', 3);
    expect(
      result.inlined.some(({ skill }) => skill.name === 'anylist') ||
        result.compact.some((s) => s.name === 'anylist'),
    ).toBe(true);
  });
});
