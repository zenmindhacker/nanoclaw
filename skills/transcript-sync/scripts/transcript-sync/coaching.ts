/**
 * Coaching analysis module for transcript-sync
 * Handles spawning coaching agents and validating analysis completeness
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  COACH_ANALYSIS_ROOT,
  COACHING_SKILL_CLIENT,
  COACHING_SKILL_COACH,
  PROCESSED_TRANSCRIPTS_PATH,
  COACHING_AGENT_TIMEOUT_SECONDS,
  COACHING_AGENT_THINKING_LEVEL,
} from './config.js';
import { logInfo, logError, logWarn } from './logger.js';
import type { ProcessedTranscripts } from './types.js';

/**
 * Validate coaching analysis completeness and return paths needing re-analysis.
 * Checks that transcripts marked as processed actually have the expected output files.
 */
export function validateCoachingAnalysis(): string[] {
  const needsReanalysis: string[] = [];

  if (!existsSync(PROCESSED_TRANSCRIPTS_PATH)) {
    return needsReanalysis;
  }

  let processed: ProcessedTranscripts;
  try {
    processed = JSON.parse(readFileSync(PROCESSED_TRANSCRIPTS_PATH, 'utf-8'));
  } catch {
    logWarn('[validation] Could not read processed-transcripts.json');
    return needsReanalysis;
  }

  for (const [transcriptPath, entry] of Object.entries(processed.processed)) {
    // Only check coaching transcripts that claim to be analyzed
    if (!entry.coachAnalysis) continue;
    if (!transcriptPath.includes('/coaching/')) continue;

    // Extract client name and date from path
    const match = transcriptPath.match(/coaching\/(\w+)\/transcripts\/(\d{4}-\d{2}-\d{2})/);
    if (!match) continue;

    const [, client, date] = match;

    // Check if session-insight file exists for this date
    const sessionInsightsDir = join(COACH_ANALYSIS_ROOT, client, 'session-insights');
    const methodologyDir = join(COACH_ANALYSIS_ROOT, client, 'methodology');

    let hasSessionInsight = false;
    let hasMethodology = false;

    if (existsSync(sessionInsightsDir)) {
      const files = readdirSync(sessionInsightsDir);
      hasSessionInsight = files.some((f: string) => f.startsWith(date));
    }

    if (existsSync(methodologyDir)) {
      const files = readdirSync(methodologyDir);
      hasMethodology = files.some((f: string) => f.startsWith(date));
    }

    // If missing expected outputs, queue for re-analysis
    if (!hasSessionInsight || !hasMethodology) {
      const missing = [];
      if (!hasSessionInsight) missing.push('session-insight');
      if (!hasMethodology) missing.push('methodology');
      logWarn(`[validation] ${client}/${date}: missing ${missing.join(', ')}`);
      needsReanalysis.push(transcriptPath);
    }
  }

  if (needsReanalysis.length > 0) {
    logInfo(`[validation] Found ${needsReanalysis.length} transcript(s) needing re-analysis`);
  }

  return needsReanalysis;
}

/**
 * Spawn coaching analysis using openclaw cron for better tracking and reliability.
 * Uses one-shot scheduled job instead of fire-and-forget shell background process.
 */
export function spawnCoachingAnalysis(paths: string[]): void {
  const pathList = paths.join(', ');
  const jobName = `coaching-analysis-${Date.now()}`;

  const task = `Run coaching analysis on these new transcripts: ${pathList}

Skills:
- Client analysis: ${COACHING_SKILL_CLIENT}
- Coach analysis: ${COACHING_SKILL_COACH}

Follow each skill doc exactly. Write all output files.

IMPORTANT: After completing analysis for each transcript, update the processed-transcripts.json file at:
${PROCESSED_TRANSCRIPTS_PATH}

For each transcript path, ensure the entry has:
- coachAnalysis: true
- updatedAt: current ISO timestamp
- note: brief session summary

Do NOT git add, commit, or push anything.`;

  // Coaching analysis spawn not available in NanoClaw container.
  // Log the pending transcripts so they can be processed manually.
  logWarn(`[coaching] Auto-spawn not available in container. ${paths.length} transcript(s) need coaching analysis:`);
  for (const p of paths) {
    logWarn(`[coaching]   ${p}`);
  }
  logWarn('[coaching] Run coaching analysis manually or trigger via main group.');
}

