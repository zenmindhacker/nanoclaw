/**
 * Shared helper utilities for transcript-sync.
 */

import type { Attendee } from './types.js';

export function slugify(text: string): string {
  const slug = text
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return slug || 'meeting';
}

export function mergeAttendees(shadowAttendees: Attendee[], gcalAttendees: Attendee[]): Attendee[] {
  const merged: Attendee[] = [];
  const seen = new Set<string>();

  for (const a of [...shadowAttendees, ...gcalAttendees]) {
    const key = `${a.email || ''}|${a.name || ''}|${a.isSelf}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(a);
    }
  }

  return merged;
}
