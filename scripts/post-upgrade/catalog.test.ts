import { describe, expect, it } from 'vitest';

import { buildCatalogForQuery } from '../../src/modules/skills/catalog.js';

describe('post-upgrade skills catalog smoke', () => {
  it('ranks transcript-search for Cleo-style queries', () => {
    const skills = [
      { name: 'transcript-search', description: 'Search meeting transcripts from Shadow SQLite' },
      { name: 'anylist', description: 'AnyList grocery lists' },
      { name: 'todoist', description: 'Todoist tasks' },
    ];
    const result = buildCatalogForQuery(skills, 'find meeting transcripts about ganttsy planning', 3);
    expect(result.inlined.some(({ skill }) => skill.name === 'transcript-search')).toBe(true);
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
