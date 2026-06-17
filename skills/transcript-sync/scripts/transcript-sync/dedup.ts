/**
 * Deduplication — detects duplicate meetings across sources and previous runs.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DEDUP_TIME_WINDOW_MS } from './config.js';
import type { UnifiedMeeting } from './types.js';

export interface ExistingTranscripts {
  gcalEventIds: Set<string>;
  shadowConvIdxs: Set<number>;
  ganttsyWorkspaceDocIds: Set<string>;
}

// Scan existing transcript files for identifying metadata (cross-run deduplication)
export function scanExistingTranscripts(directories: string[]): ExistingTranscripts {
  const gcalEventIds = new Set<string>();
  const shadowConvIdxs = new Set<number>();
  const ganttsyWorkspaceDocIds = new Set<string>();

  for (const dir of directories) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir);
      const mdFiles = entries.filter(f => f.endsWith('.md')).map(f => join(dir, f));

      for (const file of mdFiles) {
        try {
          const content = readFileSync(file, 'utf-8');

          const gcalMatch = content.match(/^- gcal_event_id: (.+)$/m);
          if (gcalMatch && gcalMatch[1]) {
            gcalEventIds.add(gcalMatch[1].trim());
          }

          const shadowMatch = content.match(/^- shadow_convIdx: (\d+)$/m);
          if (shadowMatch && shadowMatch[1]) {
            shadowConvIdxs.add(parseInt(shadowMatch[1].trim(), 10));
          }

          const ganttsyMatch = content.match(/^- ganttsy_workspace_doc_id: (.+)$/m);
          if (ganttsyMatch && ganttsyMatch[1]) {
            ganttsyWorkspaceDocIds.add(ganttsyMatch[1].trim());
          }
        } catch {
          // ignore read errors
        }
      }
    } catch {
      // ignore directory read errors
    }
  }

  return { gcalEventIds, shadowConvIdxs, ganttsyWorkspaceDocIds };
}

// Legacy wrapper — kept for compatibility but delegates to scanExistingTranscripts
export function scanExistingGcalEventIds(directories: string[]): Set<string> {
  return scanExistingTranscripts(directories).gcalEventIds;
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
