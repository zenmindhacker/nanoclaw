/**
 * Deduplication — detects duplicate meetings across sources and previous runs.
 */

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { DEDUP_TIME_WINDOW_MS } from './config.js';
import type { UnifiedMeeting } from './types.js';

// Scan existing transcript files for gcal_event_ids (cross-run deduplication)
export function scanExistingGcalEventIds(directories: string[]): Set<string> {
  const gcalEventIds = new Set<string>();

  for (const dir of directories) {
    if (!existsSync(dir)) continue;

    try {
      const files = execSync(`find "${dir}" -name "*.md" -type f -mtime -7 2>/dev/null || true`, {
        encoding: 'utf-8',
        shell: '/bin/bash',
      }).trim().split('\n').filter(Boolean);

      for (const file of files) {
        try {
          const content = readFileSync(file, 'utf-8');
          const match = content.match(/^- gcal_event_id: (.+)$/m);
          if (match && match[1]) {
            gcalEventIds.add(match[1].trim());
          }
        } catch {
          // ignore read errors
        }
      }
    } catch {
      // ignore find errors
    }
  }

  return gcalEventIds;
}

export const NAME_REPLACEMENTS: [RegExp, string][] = [
  [/Vveerrgg Eeee/g, 'Vergel'],
];

export function normalizeNames(text: string): string {
  let result = text;
  for (const [pattern, replacement] of NAME_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function meetingsAreDuplicates(
  a: UnifiedMeeting,
  b: UnifiedMeeting
): boolean {
  // Method 1: Same gcal event_id (most reliable)
  if (a.gcalEventId && b.gcalEventId && a.gcalEventId === b.gcalEventId) {
    return true;
  }

  // Method 2: Start times within 5 minute window
  const timeDiff = Math.abs(a.startedAt.getTime() - b.startedAt.getTime());
  if (timeDiff <= DEDUP_TIME_WINDOW_MS) {
    return true;
  }

  return false;
}
