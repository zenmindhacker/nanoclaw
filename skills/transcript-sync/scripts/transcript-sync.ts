#!/usr/bin/env node
/**
 * transcript-sync — Main orchestrator (v2: calendar-anchored LLM pipeline)
 *
 * Architecture:
 *   Stage 1 — Ingest: batch-fetch calendar events + transcripts (Shadow, Drive)
 *   Stage 2 — Candidate pairing: match transcripts to calendar events (±45 min)
 *   Stage 3 — LLM classification: cheap model resolves ambiguous matches
 *   Stage 4 — Route & commit: write markdown, git push
 *
 * Calendar auth failures are FATAL — pipeline halts and posts to #sysops.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

// Config
import {
  SHADOW_DB_PATH as DB_PATH,
  GITHUB_ROOT,
  KEVIN_COACHING_TRANSCRIPTS,
  CHRISTINA_COACHING_TRANSCRIPTS,
  MONDO_ZEN_COACHING_TRANSCRIPTS,
  PERSONAL_TRANSCRIPTS,
  TESTBOARD_TRANSCRIPTS,
  DEFAULT_CALENDAR_IDS,
  DEDUP_TIME_WINDOW_MS,
  MIN_TRANSCRIPT_ROWS,
  CALENDAR_WINDOW_MINUTES,
} from './transcript-sync/config.js';

// Types
import type {
  Attendee,
  CalendarEvent,
  CalendarMeta,
  ClassificationContext,
  ConversationRow,
  MatchResult,
  State,
  Args,
  UnifiedMeeting,
  PendingMeeting,
} from './transcript-sync/types.js';

// Modules
import { logInfo, logError, logWarn } from './transcript-sync/logger.js';
import { loadState, saveState } from './transcript-sync/state.js';
import { slugify, mergeAttendees } from './transcript-sync/helpers.js';
import { hasConfidentialityTrigger, confirmConfidentialWithLLM } from './transcript-sync/confidentiality.js';
import { getCalendarService, assertCalendarAuthHealthy, fetchCalendarEvents, calendarEventToMeta, postCalendarFailureToSysops } from './transcript-sync/calendar.js';
import { matchTranscript } from './transcript-sync/matcher.js';
import { classifyTarget, classifyGanttsySubRoute, isLikelyKevinCoachingFromContent } from './transcript-sync/classification.js';
import { scanExistingTranscripts, normalizeNames } from './transcript-sync/dedup.js';
import type { ExistingTranscripts } from './transcript-sync/dedup.js';
import { cleanStalePendingFiles, extractAndSavePendingActions, postPendingSummaryToSysops } from './transcript-sync/pending-actions.js';
import { validateCoachingAnalysis, spawnCoachingAnalysis } from './transcript-sync/coaching.js';

// Sources
import { parseShadowDt, fetchAttendees, fetchTranscriptRows } from './transcript-sync/sources/shadow.js';
import {
  fetchGanttsyWorkspaceDocs,
  fetchGanttsyWorkspaceTranscript,
  parseGanttsyWorkspaceMeetingDate,
  parseGanttsyWorkspaceAttendees,
} from './transcript-sync/sources/ganttsy.js';

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): Args {
  const args: Args = {
    dryRun: false,
    limit: 50,
    sinceDays: 30,
    reportOnly: false,
    force: false,
    noCalendar: false,
    calendarWindowMinutes: CALENDAR_WINDOW_MINUTES,
    calendarIds: DEFAULT_CALENDAR_IDS,
    tasksMode: 'auto',
    tasksMinConfidence: 0.72,
    tasksMaxItems: 6,
    shadowOnly: false,
    ganttsyWorkspaceOnly: false,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--limit') {
      args.limit = parseInt(process.argv[++i], 10);
    } else if (arg === '--since-days') {
      args.sinceDays = parseInt(process.argv[++i], 10);
    } else if (arg === '--report-only') {
      args.reportOnly = true;
    } else if (arg === '--calendar-window-minutes') {
      args.calendarWindowMinutes = parseInt(process.argv[++i], 10);
    } else if (arg === '--calendar-ids') {
      args.calendarIds = process.argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--tasks-mode') {
      args.tasksMode = process.argv[++i];
    } else if (arg === '--tasks-min-confidence') {
      args.tasksMinConfidence = parseFloat(process.argv[++i]);
    } else if (arg === '--tasks-max-items') {
      args.tasksMaxItems = parseInt(process.argv[++i], 10);
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--shadow-only') {
      args.shadowOnly = true;
    } else if (arg === '--ganttsy-workspace-only') {
      args.ganttsyWorkspaceOnly = true;
    }
  }

  return args;
}

// ============================================================================
// Manual classifications — overrides set by the user via classify-transcript.ts
// ============================================================================

/**
 * Map org slug (as accepted by classify-transcript.ts) to the target
 * transcripts directory. When a meeting has a manual classification, the
 * pipeline routes straight to one of these paths and skips the calendar /
 * attendee classifier entirely.
 */
const ORG_TARGET_DIRS: Record<string, string> = {
  ganttsy: `${GITHUB_ROOT}/ganttsy/ganttsy-docs/transcripts`,
  'ganttsy-strategy': `${GITHUB_ROOT}/ganttsy/ganttsy-strategy/transcripts`,
  ct: `${GITHUB_ROOT}/copperteams/ct-docs/planning/transcripts`,
  ctci: `${GITHUB_ROOT}/cognitivetech/ctci-docs/transcripts`,
  nvs: `${GITHUB_ROOT}/nvs/nvs-docs/transcripts`,
  personal: PERSONAL_TRANSCRIPTS,
  kevin: KEVIN_COACHING_TRANSCRIPTS,
  christina: CHRISTINA_COACHING_TRANSCRIPTS,
  'mondo-zen': MONDO_ZEN_COACHING_TRANSCRIPTS,
  testboard: TESTBOARD_TRANSCRIPTS,
};

const CLASSIFICATIONS_PATH = join(
  process.env.SKILLS_ROOT || '/workspace/extra/skills',
  'transcript-sync',
  '.classifications.json',
);

/**
 * Load user-submitted classification overrides. Keys are `<source>=<id>`
 * (e.g. `shadow=362`); values are either an `ORG_TARGET_DIRS` key or the
 * literal string `skip` (permanently ignore the meeting).
 */
function loadClassifications(): Record<string, string> {
  if (!existsSync(CLASSIFICATIONS_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(CLASSIFICATIONS_PATH, 'utf-8'));
    return raw.overrides || {};
  } catch (err: any) {
    logWarn(`[classifications] failed to load ${CLASSIFICATIONS_PATH}: ${err.message}`);
    return {};
  }
}

/** Remove an override from the file — called once the pipeline has acted on it. */
function clearClassification(key: string): void {
  if (!existsSync(CLASSIFICATIONS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(CLASSIFICATIONS_PATH, 'utf-8'));
    if (!raw.overrides || !raw.overrides[key]) return;
    delete raw.overrides[key];
    raw.updatedAt = new Date().toISOString();
    const tmp = `${CLASSIFICATIONS_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(raw, null, 2));
    renameSync(tmp, CLASSIFICATIONS_PATH);
  } catch (err: any) {
    logWarn(`[classifications] failed to clear ${key}: ${err.message}`);
  }
}

// ============================================================================
// Per-meeting processing (Stage 4: Route & Write)
// ============================================================================

async function processMeeting(
  meeting: UnifiedMeeting,
  args: Args,
  state: State,
  allCalendarEvents: CalendarEvent[],
  coachingPaths: string[],
  workPaths: string[],
  pendingMeetings: PendingMeeting[],
  unmatchedMeetings: Array<{ id: string; source: string; title: string; startedAt: string; reason?: string }>,
  classifications: Record<string, string>
): Promise<{ wrote: boolean; path?: string }> {
  const title = meeting.title || `Meeting ${meeting.id}`;

  // --- Manual classification override ---------------------------------------
  const overrideKey = `${meeting.source}=${meeting.id}`;
  const override = classifications[overrideKey];
  if (override === 'skip') {
    logInfo(`[override] ${overrideKey} skip (user-requested)`);
    if (meeting.source === 'shadow') {
      const idNum = parseInt(String(meeting.id), 10);
      state.skippedConvs = state.skippedConvs || [];
      if (!state.skippedConvs.includes(idNum)) state.skippedConvs.push(idNum);
      saveState(state);
    } else if (meeting.source === 'ganttsy_workspace') {
      state.skippedGanttsyWorkspaceIds = state.skippedGanttsyWorkspaceIds || [];
      if (!state.skippedGanttsyWorkspaceIds.includes(String(meeting.id))) {
        state.skippedGanttsyWorkspaceIds.push(String(meeting.id));
      }
      saveState(state);
    }
    clearClassification(overrideKey);
    return { wrote: false };
  }

  // Get transcript text
  let transcriptText = '';
  if (meeting.source === 'shadow' && meeting.shadowTranscriptRows) {
    transcriptText = meeting.shadowTranscriptRows.map(r => `${r.spkrName || ''}: ${r.transContent || ''}`).join('\n');
  } else if (meeting.source === 'ganttsy_workspace' && meeting.ganttsyWorkspaceData) {
    transcriptText = meeting.ganttsyWorkspaceData.transcript;
  }

  if (!transcriptText.trim()) {
    logInfo(`[skip] ${meeting.source}=${meeting.id} empty transcript`);
    return { wrote: false };
  }

  // Confidentiality check
  if (hasConfidentialityTrigger(transcriptText)) {
    logInfo(`[confidential] Trigger found in ${meeting.source}=${meeting.id}, checking with LLM...`);
    if (confirmConfidentialWithLLM(transcriptText, title)) {
      logInfo(`[confidential] ${meeting.source}=${meeting.id} confirmed confidential, skipping`);
      if (meeting.source === 'shadow') {
        state.skippedConvs = state.skippedConvs || [];
        state.skippedConvs.push(parseInt(meeting.id));
      } else if (meeting.source === 'ganttsy_workspace') {
        state.skippedGanttsyWorkspaceIds = state.skippedGanttsyWorkspaceIds || [];
        state.skippedGanttsyWorkspaceIds.push(meeting.id);
      }
      saveState(state);
      return { wrote: false };
    }
    logInfo(`[confidential] ${meeting.source}=${meeting.id} LLM says OK, proceeding`);
  }

  // --- Stage 2+3: Match transcript to calendar event -----------------------
  // Use pre-fetched match result if available, otherwise run matcher now.
  let matchResult = meeting.matchResult;
  if (!matchResult) {
    matchResult = await matchTranscript(
      meeting.startedAt,
      title,
      transcriptText,
      allCalendarEvents,
    );
  }

  // Build gcalMeta + attendees from match result
  let gcalMeta: CalendarMeta | null = meeting.gcalMeta;
  let attendees = [...meeting.attendees];

  if (matchResult.event) {
    gcalMeta = calendarEventToMeta(matchResult.event);
    attendees = mergeAttendees(attendees, matchResult.event.attendees);
  }

  // --- Apply manual org override (if set) ----------------------------------
  let targetDir: string;
  let baseReason: string;
  if (override && ORG_TARGET_DIRS[override]) {
    targetDir = ORG_TARGET_DIRS[override];
    baseReason = `override:${override}`;
    logInfo(`[override] ${overrideKey} → ${override} (user-classified)`);
    clearClassification(overrideKey);
  } else if (matchResult.org && ORG_TARGET_DIRS[matchResult.org]) {
    // LLM classified directly to an org (no calendar match needed)
    targetDir = ORG_TARGET_DIRS[matchResult.org];
    baseReason = matchResult.reason;
  } else if (matchResult.method === 'none' && !matchResult.event) {
    // No match and no LLM classification — route to unmatched
    logWarn(`[skip] ${meeting.source}=${meeting.id} no_match title=${JSON.stringify(title)} started=${meeting.startedAt.toISOString()} reason=${matchResult.reason}`);
    unmatchedMeetings.push({
      id: String(meeting.id),
      source: meeting.source,
      title,
      startedAt: meeting.startedAt.toISOString(),
      reason: matchResult.reason,
    });
    return { wrote: false };
  } else {
    // Have a calendar match (auto or LLM) — use attendee-based classifier
    const classified = classifyTarget(title, attendees, gcalMeta);
    targetDir = classified.targetDir;
    baseReason = classified.reason;
  }

  const ctciDir = join(GITHUB_ROOT, 'cognitivetech/ctci-docs/transcripts');

  // Kevin coaching content heuristic
  if (targetDir === ctciDir && isLikelyKevinCoachingFromContent(title, transcriptText)) {
    targetDir = KEVIN_COACHING_TRANSCRIPTS;
    baseReason = 'rule:kevin_content_heuristic';
  }

  // Ganttsy workspace fallback: docs from Drive folder always route to Ganttsy repos
  const ganttsyDirs = [
    join(GITHUB_ROOT, 'ganttsy/ganttsy-docs/transcripts'),
    join(GITHUB_ROOT, 'ganttsy/ganttsy-strategy/transcripts'),
  ];
  if (!override && meeting.source === 'ganttsy_workspace' && !ganttsyDirs.includes(targetDir)) {
    const ctx: ClassificationContext = {
      title,
      titleLower: title.toLowerCase(),
      emails: attendees.map((a: Attendee) => a.email).filter(Boolean),
      names: attendees.map((a: Attendee) => a.name?.toLowerCase()).filter(Boolean),
      nonself: attendees.filter((a: Attendee) => !a.isSelf),
      nonselfEmails: attendees.filter((a: Attendee) => !a.isSelf && a.email).map((a: Attendee) => a.email),
      nonselfNames: attendees.filter((a: Attendee) => !a.isSelf && a.name).map((a: Attendee) => a.name?.toLowerCase()),
      gcalTitle: (gcalMeta?.event_title || '').toLowerCase(),
      gcalDescription: (gcalMeta?.event_description || '').toLowerCase(),
      gcalCalendarId: (gcalMeta?.calendar_id || '').toLowerCase(),
    };
    const result = classifyGanttsySubRoute(ctx);
    targetDir = result.targetDir;
    baseReason = `ganttsy_workspace_fallback|${result.reason}`;
  }

  let reason = `${meeting.source}|${matchResult.method}|${baseReason}`;

  const ts = meeting.startedAt.toISOString().split('T')[0];
  const titleForFilename = (gcalMeta?.event_title || title || `meeting-${meeting.id}`).trim();
  let filename = `${ts}-${slugify(titleForFilename)}.md`;
  let outPath = join(targetDir, filename);
  if (existsSync(outPath)) {
    filename = `${ts}-${meeting.source}-${meeting.id}-${slugify(titleForFilename)}.md`;
    outPath = join(targetDir, filename);
  }

  if (args.reportOnly) {
    let info = '';
    if (gcalMeta) {
      info = ` | gcal=${gcalMeta.event_title} @ ${gcalMeta.event_start}`;
    }
    logInfo(`[REPORT] ${meeting.source}=${meeting.id} -> ${targetDir} | reason=${reason} | title=${title}${info}`);
    return { wrote: false };
  }

  // Build markdown content
  const lines = [
    `# ${title}`,
    '',
    `- source: ${meeting.source}`,
    `- id: ${meeting.id}`,
    `- started: ${meeting.startedAt.toISOString()}`,
    `- ended: ${meeting.endedAt?.toISOString() || 'unknown'}`,
    `- routing_reason: ${reason}`,
    `- match_method: ${matchResult.method}`,
    `- match_confidence: ${matchResult.confidence}`,
    `- attendee_count: ${attendees.length}`,
  ];

  if (meeting.source === 'shadow' && meeting.shadowData) {
    lines.push(`- shadow_convIdx: ${meeting.shadowData.convIdx}`);
    lines.push(`- shadow_convUuid: ${meeting.shadowData.convUuid}`);
  }

  if (meeting.source === 'ganttsy_workspace' && meeting.ganttsyWorkspaceData) {
    lines.push(`- ganttsy_workspace_doc_id: ${meeting.ganttsyWorkspaceData.doc.id}`);
    lines.push(`- ganttsy_workspace_url: ${meeting.ganttsyWorkspaceData.doc.webViewLink}`);
    lines.push(`- ganttsy_workspace_modified: ${meeting.ganttsyWorkspaceData.doc.modifiedTime}`);
  }

  if (gcalMeta) {
    const desc = (gcalMeta.event_description || '').replace(/\s+/g, ' ').trim();
    const desc500 = desc.length > 500 ? `${desc.slice(0, 500)}…` : desc;
    lines.push(`- gcal_event_id: ${gcalMeta.event_id}`);
    lines.push(`- gcal_event_title: ${gcalMeta.event_title}`);
    lines.push(`- gcal_event_start: ${gcalMeta.event_start}`);
    lines.push(`- gcal_calendar_id: ${gcalMeta.calendar_id}`);
    lines.push(`- gcal_attendees: ${gcalMeta.attendee_names.join(', ')}`);
    lines.push(`- gcal_event_description: ${desc500}`);
  }

  lines.push('', '## Attendees');
  if (attendees.length > 0) {
    for (const a of attendees) {
      const nm = a.name || '(no name)';
      const em = a.email || '(no email)';
      const src = a.source || 'unknown';
      const selfTag = a.isSelf ? ' self' : '';
      lines.push(`- ${nm} <${em}> [${src}]${selfTag}`);
    }
  } else {
    lines.push('- (none)');
  }

  lines.push('', '## Transcript', '');

  if (meeting.source === 'ganttsy_workspace' && meeting.ganttsyWorkspaceData) {
    lines.push(meeting.ganttsyWorkspaceData.transcript);
  } else if (meeting.source === 'shadow' && meeting.shadowTranscriptRows) {
    for (const r of meeting.shadowTranscriptRows) {
      const speaker = r.spkrName || 'Speaker';
      const content = r.transContent.trim();
      if (!content) continue;
      lines.push(`- **${speaker}**: ${content}`);
    }
  }

  const body = normalizeNames(lines.join('\n').trim() + '\n');

  if (args.dryRun) {
    logInfo(`[DRY] ${meeting.source}=${meeting.id} -> ${outPath} | reason=${reason}`);
    return { wrote: false };
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  writeFileSync(outPath, body);
  logInfo(`Wrote ${outPath}`);

  // Route: coaching vs work
  if (outPath.includes('/coaching/')) {
    coachingPaths.push(outPath);
  } else {
    workPaths.push(outPath);
    const dateStr = meeting.startedAt.toISOString().split('T')[0];
    const pending = await extractAndSavePendingActions(
      outPath,
      targetDir,
      title,
      dateStr,
      args.tasksMode,
      args.tasksMinConfidence,
      args.tasksMaxItems
    );
    if (pending) pendingMeetings.push(pending);
  }

  return { wrote: true, path: outPath };
}

// ============================================================================
// Main loop
// ============================================================================

async function main() {
  const args = parseArgs();
  const state = loadState();

  // Validate previous coaching analysis completeness
  const incompleteCoachingPaths = validateCoachingAnalysis();
  if (incompleteCoachingPaths.length > 0 && !args.dryRun && !args.reportOnly) {
    logInfo(`[validation] Triggering re-analysis for ${incompleteCoachingPaths.length} incomplete transcript(s)`);
    spawnCoachingAnalysis(incompleteCoachingPaths);
  }

  // ==========================================================================
  // Stage 1A: Calendar — MANDATORY. Fail loudly if broken.
  // ==========================================================================
  const service = getCalendarService();
  if (!service) {
    const msg = 'GCAL_REQUIRED: Calendar service failed to init. Fix credentials.';
    postCalendarFailureToSysops(msg);
    throw new Error(msg);
  }
  await assertCalendarAuthHealthy(service, args.calendarIds);

  // Batch-fetch ALL calendar events for the sync window
  const calTimeMin = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000);
  const calTimeMax = new Date(Date.now() + 60 * 60 * 1000); // +1h buffer
  const allCalendarEvents = await fetchCalendarEvents(service, args.calendarIds, calTimeMin, calTimeMax);

  if (allCalendarEvents.length === 0) {
    const msg = `GCAL_EMPTY: 0 calendar events fetched for ${args.sinceDays}-day window. This is likely a bug — check calendar IDs and credentials.`;
    postCalendarFailureToSysops(msg);
    throw new Error(msg);
  }

  logInfo(`[mode] Idempotent sync, lookback=${args.sinceDays} days, calendar_events=${allCalendarEvents.length}`);

  // ==========================================================================
  // Stage 1B: Pre-scan existing transcript files for deduplication
  // ==========================================================================
  const transcriptDirs = [
    join(GITHUB_ROOT, 'ganttsy/ganttsy-docs/transcripts'),
    join(GITHUB_ROOT, 'ganttsy/ganttsy-strategy/transcripts'),
    join(GITHUB_ROOT, 'copperteams/ct-docs/planning/transcripts'),
    join(GITHUB_ROOT, 'cognitivetech/ctci-docs/transcripts'),
    join(GITHUB_ROOT, 'nvs/nvs-docs/transcripts'),
    KEVIN_COACHING_TRANSCRIPTS,
    CHRISTINA_COACHING_TRANSCRIPTS,
    MONDO_ZEN_COACHING_TRANSCRIPTS,
    PERSONAL_TRANSCRIPTS,
    TESTBOARD_TRANSCRIPTS,
  ];
  const existingTranscripts = args.force
    ? { gcalEventIds: new Set<string>(), shadowConvIdxs: new Set<number>(), ganttsyWorkspaceDocIds: new Set<string>() }
    : scanExistingTranscripts(transcriptDirs);
  if (args.force) {
    logInfo(`[force] Bypassing dedup — all meetings in the ${args.sinceDays}-day window will be re-processed`);
  } else if (existingTranscripts.gcalEventIds.size > 0 || existingTranscripts.shadowConvIdxs.size > 0 || existingTranscripts.ganttsyWorkspaceDocIds.size > 0) {
    logInfo(`[dedup] Existing transcripts: gcal_events=${existingTranscripts.gcalEventIds.size} shadow_convIdxs=${existingTranscripts.shadowConvIdxs.size} ganttsy_docs=${existingTranscripts.ganttsyWorkspaceDocIds.size}`);
  }

  // ==========================================================================
  // Stage 1C: Fetch transcripts from sources
  // ==========================================================================
  const ganttsyWorkspaceMeetings: UnifiedMeeting[] = [];
  const shadowMeetings: UnifiedMeeting[] = [];

  // --- Ganttsy Google Workspace ---
  if (!args.shadowOnly) {
    try {
      const modifiedAfter = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString();
      const docs = await fetchGanttsyWorkspaceDocs(modifiedAfter, args.limit);
      const skippedGanttsyWorkspaceIds = new Set(state.skippedGanttsyWorkspaceIds || []);

      for (const doc of docs) {
        if (skippedGanttsyWorkspaceIds.has(doc.id)) continue;
        if (existingTranscripts.ganttsyWorkspaceDocIds.has(doc.id)) continue;

        const transcript = await fetchGanttsyWorkspaceTranscript(doc.id);
        if (!transcript) continue;

        const attendeeEmails = parseGanttsyWorkspaceAttendees(transcript);
        const selfEmails = ['cian@cognitivetech.net', 'cian@ganttsy.com', 'cian.whalley@newvaluegroup.com'];
        const attendees: Attendee[] = attendeeEmails.map(email => ({
          name: '',
          email: email.toLowerCase(),
          isSelf: selfEmails.includes(email.toLowerCase()) ? 1 : 0,
          source: 'ganttsy_workspace',
        }));

        const meetingDate = parseGanttsyWorkspaceMeetingDate(doc.name, doc.modifiedTime);

        ganttsyWorkspaceMeetings.push({
          source: 'ganttsy_workspace',
          id: doc.id,
          title: doc.name,
          startedAt: meetingDate,
          endedAt: null,
          gcalEventId: null,
          attendees,
          gcalMeta: null,
          ganttsyWorkspaceData: { doc, transcript },
        });
      }

      logInfo(`[ganttsy_workspace] Fetched ${ganttsyWorkspaceMeetings.length} meeting(s)`);
    } catch (err: any) {
      logError(`[ganttsy_workspace] Error: ${err.message}`);
    }
  }

  // --- Shadow ---
  if (!args.ganttsyWorkspaceOnly && existsSync(DB_PATH)) {
    const db = new Database(DB_PATH, { readonly: true });

    let convs: ConversationRow[] = db.prepare(`
      SELECT convIdx, convUuid, convTitle, convStartedAt, convEndedAt, convCreatedAt
      FROM SHADOW_CONVERSATION
      WHERE datetime(replace(substr(convStartedAt,1,19),'T',' ')) >= datetime('now', ?)
        AND transStatus = 3
      ORDER BY convIdx DESC
      LIMIT ?
    `).all(`-${args.sinceDays} days`, Math.max(args.limit, 500)) as any[];

    convs = convs.filter(c => !existingTranscripts.shadowConvIdxs.has(c.convIdx));
    const skippedConvs = new Set(state.skippedConvs || []);

    for (const c of convs) {
      if (skippedConvs.has(c.convIdx)) continue;

      const rows = fetchTranscriptRows(db, c.convIdx);
      if (rows.length === 0) continue;
      if (rows.length < MIN_TRANSCRIPT_ROWS) {
        logInfo(`[skip] shadow=${c.convIdx} has only ${rows.length} rows (min=${MIN_TRANSCRIPT_ROWS})`);
        continue;
      }

      const shadowAttendees = fetchAttendees(db, c.convUuid);

      shadowMeetings.push({
        source: 'shadow',
        id: String(c.convIdx),
        title: c.convTitle || `Conversation ${c.convIdx}`,
        startedAt: parseShadowDt(c.convStartedAt),
        endedAt: c.convEndedAt ? parseShadowDt(c.convEndedAt) : null,
        gcalEventId: null,
        attendees: shadowAttendees,
        gcalMeta: null,
        shadowData: c,
        shadowTranscriptRows: rows,
      });
    }

    db.close();
    logInfo(`[shadow] Fetched ${shadowMeetings.length} conversation(s)`);
  } else if (!args.ganttsyWorkspaceOnly) {
    logWarn(`[shadow] DB not found at ${DB_PATH}`);
  }

  // ==========================================================================
  // Deduplicate: prioritize Ganttsy Workspace > Shadow
  // ==========================================================================
  const processedTimeWindows: Date[] = [];
  const toProcess: UnifiedMeeting[] = [];
  const dedupedShadowIds: string[] = [];

  for (const gw of ganttsyWorkspaceMeetings) {
    toProcess.push(gw);
    processedTimeWindows.push(gw.startedAt);
  }

  for (const sm of shadowMeetings) {
    const isDuplicate = processedTimeWindows.some(otherTime => {
      const diff = Math.abs(sm.startedAt.getTime() - otherTime.getTime());
      return diff <= DEDUP_TIME_WINDOW_MS;
    });

    if (isDuplicate) {
      logInfo(`[dedup] shadow=${sm.id} matches higher priority source by time window, skipping`);
      dedupedShadowIds.push(sm.id);
      continue;
    }

    toProcess.push(sm);
  }

  if (toProcess.length === 0) {
    logInfo('No new meetings to process.');
    return;
  }

  logInfo(`Processing ${toProcess.length} meeting(s) (deduped ${dedupedShadowIds.length} shadow)`);

  // ==========================================================================
  // Stage 2+3+4: Match, classify, route each meeting
  // ==========================================================================
  const buckets: Map<string, number> = new Map();
  const coachingPaths: string[] = [];
  const workPaths: string[] = [];
  const pendingMeetings: PendingMeeting[] = [];
  const unmatchedMeetings: Array<{ id: string; source: string; title: string; startedAt: string; reason?: string }> = [];

  const classifications = loadClassifications();
  const classificationCount = Object.keys(classifications).length;
  if (classificationCount > 0) {
    logInfo(`[classifications] ${classificationCount} manual override(s) loaded`);
  }

  // Apply skip overrides eagerly
  for (const [key, org] of Object.entries(classifications)) {
    if (org !== 'skip') continue;
    const m = key.match(/^(\w+)=(.+)$/);
    if (!m) continue;
    const [, src, id] = m;
    if (src === 'shadow') {
      const idNum = parseInt(id, 10);
      state.skippedConvs = state.skippedConvs || [];
      if (!state.skippedConvs.includes(idNum)) state.skippedConvs.push(idNum);
    } else if (src === 'ganttsy_workspace') {
      state.skippedGanttsyWorkspaceIds = state.skippedGanttsyWorkspaceIds || [];
      if (!state.skippedGanttsyWorkspaceIds.includes(id)) state.skippedGanttsyWorkspaceIds.push(id);
    } else {
      continue;
    }
    logInfo(`[override] ${key} skip (user-requested, applied eagerly)`);
    clearClassification(key);
    delete classifications[key];
  }
  if (Object.keys(classifications).length !== classificationCount) {
    saveState(state);
  }
  let exported = 0;

  cleanStalePendingFiles();

  for (const meeting of toProcess) {
    const result = await processMeeting(meeting, args, state, allCalendarEvents, coachingPaths, workPaths, pendingMeetings, unmatchedMeetings, classifications);

    if (result.wrote) {
      exported++;
      if (result.path) {
        const dir = result.path.substring(0, result.path.lastIndexOf('/'));
        buckets.set(dir, (buckets.get(dir) || 0) + 1);
      }
    }
  }

  // Log routing summary
  const sorted = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1]);
  const summary = sorted.map(([k, v]) => `${k}:${v}`).join(' | ');
  if (summary) {
    logInfo(`Routing: ${summary}`);
  }

  // Spawn coaching agent if needed
  if (coachingPaths.length > 0 && !args.dryRun && !args.reportOnly) {
    spawnCoachingAnalysis(coachingPaths);
  }

  // Post pending action items summary to #sysops for human approval
  if (pendingMeetings.length > 0 && !args.dryRun && !args.reportOnly) {
    postPendingSummaryToSysops(pendingMeetings);
  }

  if (unmatchedMeetings.length > 0) {
    logWarn(`[unmatched] ${unmatchedMeetings.length} meeting(s) could not be matched or classified — NOT routed:`);
    for (const u of unmatchedMeetings) {
      logWarn(`  - ${u.source}=${u.id} "${u.title}" started=${u.startedAt} reason=${u.reason}`);
    }
  }

  logInfo(`Done. processed=${toProcess.length} exported=${exported} coaching=${coachingPaths.length} work=${workPaths.length} pending=${pendingMeetings.length} unmatched=${unmatchedMeetings.length} deduped_shadow=${dedupedShadowIds.length}`);

  const allWrittenPaths = [...coachingPaths, ...workPaths];
  if (allWrittenPaths.length > 0 || unmatchedMeetings.length > 0) {
    console.log(JSON.stringify({ writtenFiles: allWrittenPaths, unmatched: unmatchedMeetings }));
  }
}

main().catch(err => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
