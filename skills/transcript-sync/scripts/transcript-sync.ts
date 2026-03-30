#!/usr/bin/env node
/**
 * transcript-sync — Main orchestrator
 *
 * Syncs transcripts from multiple sources (Shadow, Google Workspace)
 * to appropriate GitHub repositories based on attendee/content classification.
 *
 * All domain logic lives in ./transcript-sync/ modules; this file is the
 * thin orchestrator: CLI parsing, per-meeting processing, and the main loop.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
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
} from './transcript-sync/config.js';

// Types
import type {
  Attendee,
  CalendarMeta,
  ClassificationContext,
  ConversationRow,
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
import { getCalendarService, assertCalendarAuthHealthy, calendarFallbackAttendees } from './transcript-sync/calendar.js';
import { classifyTarget, classifyGanttsySubRoute, isLikelyKevinCoachingFromContent } from './transcript-sync/classification.js';
import { scanExistingGcalEventIds, normalizeNames } from './transcript-sync/dedup.js';
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
    sinceDays: null,
    reportOnly: false,
    noCalendar: false,
    calendarWindowMinutes: 10,
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
    } else if (arg === '--no-calendar') {
      args.noCalendar = true;
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
    } else if (arg === '--shadow-only') {
      args.shadowOnly = true;
    } else if (arg === '--ganttsy-workspace-only') {
      args.ganttsyWorkspaceOnly = true;
    }
  }

  return args;
}

// ============================================================================
// Per-meeting processing
// ============================================================================

async function processMeeting(
  meeting: UnifiedMeeting,
  args: Args,
  state: State,
  service: any,
  coachingPaths: string[],
  workPaths: string[],
  pendingMeetings: PendingMeeting[]
): Promise<{ wrote: boolean; path?: string }> {
  const title = meeting.title || `Meeting ${meeting.id}`;

  // Get transcript text for confidentiality check
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

  // Get gcal metadata if not already present
  let gcalMeta = meeting.gcalMeta;
  let gcalAttendees: Attendee[] = [];

  if (!gcalMeta && service && meeting.startedAt) {
    [gcalAttendees, gcalMeta] = await calendarFallbackAttendees(
      service,
      meeting.startedAt.toISOString(),
      title,
      args.calendarIds,
      args.calendarWindowMinutes
    );
  }

  const attendees = mergeAttendees(meeting.attendees, gcalAttendees);
  let { targetDir, reason: baseReason } = classifyTarget(title, attendees, gcalMeta);

  const ctciDir = join(GITHUB_ROOT, 'cognitivetech/ctci-docs/transcripts');

  // Kevin coaching heuristic
  if (targetDir === ctciDir && isLikelyKevinCoachingFromContent(title, transcriptText)) {
    targetDir = KEVIN_COACHING_TRANSCRIPTS;
    baseReason = 'rule:kevin_content_heuristic';
  }

  // Ganttsy workspace fallback: docs from Ganttsy Drive folder always belong in Ganttsy repos.
  // If classification didn't already route to a Ganttsy dir, force to Ganttsy sub-route.
  const ganttsyDirs = [
    join(GITHUB_ROOT, 'ganttsy/ganttsy-docs/transcripts'),
    join(GITHUB_ROOT, 'ganttsy/ganttsy-strategy/transcripts'),
  ];
  if (meeting.source === 'ganttsy_workspace' && !ganttsyDirs.includes(targetDir)) {
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

  let reason = `${meeting.source}|${baseReason}`;
  if (gcalAttendees.length > 0) {
    reason = `${reason}|gcal_fallback`;
  }

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
    // Extract action items and save as pending (human-in-the-loop approval via #sysops)
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

  // Google Calendar is MANDATORY for correct routing. Without it, meetings
  // have no attendee data and get misrouted. Use --no-calendar only for debugging.
  const service = args.noCalendar ? null : getCalendarService();
  if (!args.noCalendar) {
    if (!service) {
      throw new Error('GCAL_REQUIRED: Calendar service failed to init. Fix credentials or use --no-calendar to skip (meetings WILL be misrouted).');
    }
    await assertCalendarAuthHealthy(service, args.calendarIds);
  }

  const ganttsyWorkspaceMeetings: UnifiedMeeting[] = [];
  const shadowMeetings: UnifiedMeeting[] = [];

  // ========================================================================
  // Fetch Ganttsy Google Workspace meetings
  // ========================================================================
  if (!args.shadowOnly) {
    try {
      let modifiedAfter: string | null = null;
      if (args.sinceDays !== null) {
        modifiedAfter = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString();
      } else if (state.lastGanttsyWorkspaceModifiedTime) {
        modifiedAfter = state.lastGanttsyWorkspaceModifiedTime;
      }

      const docs = await fetchGanttsyWorkspaceDocs(modifiedAfter, args.limit);
      const skippedGanttsyWorkspaceIds = new Set(state.skippedGanttsyWorkspaceIds || []);

      for (const doc of docs) {
        if (skippedGanttsyWorkspaceIds.has(doc.id)) {
          logInfo(`[skip] ganttsy_workspace=${doc.id} previously marked confidential`);
          continue;
        }

        const transcript = await fetchGanttsyWorkspaceTranscript(doc.id);
        if (!transcript) continue;

        // Extract attendees from doc content
        const attendeeEmails = parseGanttsyWorkspaceAttendees(transcript);
        const selfEmails = ['cian@cognitivetech.net', 'cian@ganttsy.com', 'cian.whalley@newvaluegroup.com'];
        const attendees: Attendee[] = attendeeEmails.map(email => ({
          name: '',
          email: email.toLowerCase(),
          isSelf: selfEmails.includes(email.toLowerCase()) ? 1 : 0,
          source: 'ganttsy_workspace',
        }));

        // Try to match to gcal event
        let gcalMeta: CalendarMeta | null = null;
        let gcalAttendees: Attendee[] = [];
        const meetingDate = parseGanttsyWorkspaceMeetingDate(doc.name, doc.modifiedTime);
        if (service) {
          [gcalAttendees, gcalMeta] = await calendarFallbackAttendees(
            service,
            meetingDate.toISOString(),
            doc.name,
            args.calendarIds,
            args.calendarWindowMinutes
          );
        }

        ganttsyWorkspaceMeetings.push({
          source: 'ganttsy_workspace',
          id: doc.id,
          title: doc.name,
          startedAt: meetingDate,
          endedAt: null,
          gcalEventId: gcalMeta?.event_id || null,
          attendees: mergeAttendees(attendees, gcalAttendees),
          gcalMeta,
          ganttsyWorkspaceData: { doc, transcript },
        });
      }

      logInfo(`[ganttsy_workspace] Fetched ${ganttsyWorkspaceMeetings.length} meeting(s)`);
    } catch (err: any) {
      logError(`[ganttsy_workspace] Error: ${err.message}`);
    }
  }

  // ========================================================================
  // Fetch Shadow meetings
  // ========================================================================
  if (!args.ganttsyWorkspaceOnly && existsSync(DB_PATH)) {
    const db = new Database(DB_PATH, { readonly: true });
    const lastIdx = state.lastConvIdx;

    let convs: ConversationRow[];
    if (args.sinceDays !== null) {
      convs = db.prepare(`
        SELECT convIdx, convUuid, convTitle, convStartedAt, convEndedAt, convCreatedAt
        FROM SHADOW_CONVERSATION
        WHERE datetime(replace(substr(convStartedAt,1,19),'T',' ')) >= datetime('now', ?)
          AND transStatus = 3
        ORDER BY convIdx ASC
        LIMIT ?
      `).all(`-${args.sinceDays} days`, args.limit) as any[];
    } else {
      convs = db.prepare(`
        SELECT convIdx, convUuid, convTitle, convStartedAt, convEndedAt, convCreatedAt
        FROM SHADOW_CONVERSATION
        WHERE convIdx > ?
          AND transStatus = 3
        ORDER BY convIdx ASC
        LIMIT ?
      `).all(lastIdx, args.limit) as any[];
    }

    const skippedConvs = new Set(state.skippedConvs || []);

    for (const c of convs) {
      if (skippedConvs.has(c.convIdx)) {
        logInfo(`[skip] shadow=${c.convIdx} previously marked confidential`);
        continue;
      }

      const rows = fetchTranscriptRows(db, c.convIdx);
      if (rows.length === 0) continue;

      // Check minimum transcript length
      if (rows.length < MIN_TRANSCRIPT_ROWS) {
        logInfo(`[skip] shadow=${c.convIdx} has only ${rows.length} rows (min=${MIN_TRANSCRIPT_ROWS}), likely incomplete`);
        continue;
      }

      const shadowAttendees = fetchAttendees(db, c.convUuid);

      // Try to match to gcal event
      let gcalMeta: CalendarMeta | null = null;
      let gcalAttendees: Attendee[] = [];
      if (service && c.convStartedAt) {
        [gcalAttendees, gcalMeta] = await calendarFallbackAttendees(
          service,
          c.convStartedAt,
          c.convTitle,
          args.calendarIds,
          args.calendarWindowMinutes
        );
      }

      shadowMeetings.push({
        source: 'shadow',
        id: String(c.convIdx),
        title: c.convTitle || `Conversation ${c.convIdx}`,
        startedAt: parseShadowDt(c.convStartedAt),
        endedAt: c.convEndedAt ? parseShadowDt(c.convEndedAt) : null,
        gcalEventId: gcalMeta?.event_id || null,
        attendees: mergeAttendees(shadowAttendees, gcalAttendees),
        gcalMeta,
        shadowData: c,
        shadowTranscriptRows: rows,
      });
    }

    db.close();
    logInfo(`[shadow] Fetched ${shadowMeetings.length} conversation(s)`);
  } else if (!args.ganttsyWorkspaceOnly) {
    logWarn(`[shadow] DB not found at ${DB_PATH}`);
  }

  // ========================================================================
  // Deduplicate: prioritize Ganttsy Workspace > Shadow
  // ========================================================================

  // Pre-scan existing transcript files for cross-run deduplication
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
  const existingGcalEventIds = scanExistingGcalEventIds(transcriptDirs);
  if (existingGcalEventIds.size > 0) {
    logInfo(`[dedup] Found ${existingGcalEventIds.size} existing gcal_event_ids from previous runs`);
  }

  const processedGcalEventIds = new Set<string>(existingGcalEventIds);
  const processedTimeWindows: Date[] = [];

  const toProcess: UnifiedMeeting[] = [];
  const dedupedShadowIds: string[] = [];

  // Add all Ganttsy Workspace meetings first (highest priority)
  const dedupedGanttsyWorkspaceIds: string[] = [];
  for (const gw of ganttsyWorkspaceMeetings) {
    if (gw.gcalEventId && existingGcalEventIds.has(gw.gcalEventId)) {
      logInfo(`[dedup] ganttsy_workspace=${gw.id} already exists (gcal_event_id=${gw.gcalEventId}), skipping`);
      dedupedGanttsyWorkspaceIds.push(gw.id);
      continue;
    }
    toProcess.push(gw);
    if (gw.gcalEventId) {
      processedGcalEventIds.add(gw.gcalEventId);
    }
    processedTimeWindows.push(gw.startedAt);
  }

  // Add Shadow meetings only if no higher priority duplicate
  for (const sm of shadowMeetings) {
    if (sm.gcalEventId && processedGcalEventIds.has(sm.gcalEventId)) {
      logInfo(`[dedup] shadow=${sm.id} matches higher priority source by gcal_event_id=${sm.gcalEventId}, skipping`);
      dedupedShadowIds.push(sm.id);
      continue;
    }

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

  // ========================================================================
  // Process meetings
  // ========================================================================
  const buckets: Map<string, number> = new Map();
  const coachingPaths: string[] = [];
  const workPaths: string[] = [];
  const pendingMeetings: PendingMeeting[] = [];
  let exported = 0;
  let maxShadowIdx = state.lastConvIdx;
  let maxGanttsyWorkspaceModifiedTime = state.lastGanttsyWorkspaceModifiedTime;

  // Clean up stale pending files before processing
  cleanStalePendingFiles();

  for (const meeting of toProcess) {
    const result = await processMeeting(meeting, args, state, service, coachingPaths, workPaths, pendingMeetings);

    if (result.wrote) {
      exported++;
      if (result.path) {
        const dir = result.path.substring(0, result.path.lastIndexOf('/'));
        buckets.set(dir, (buckets.get(dir) || 0) + 1);
      }
    }

    // Update watermarks
    if (meeting.source === 'shadow') {
      maxShadowIdx = Math.max(maxShadowIdx, parseInt(meeting.id));
    } else if (meeting.source === 'ganttsy_workspace' && meeting.ganttsyWorkspaceData) {
      const modifiedTime = meeting.ganttsyWorkspaceData.doc.modifiedTime;
      if (!maxGanttsyWorkspaceModifiedTime || modifiedTime > maxGanttsyWorkspaceModifiedTime) {
        maxGanttsyWorkspaceModifiedTime = modifiedTime;
      }
    }
  }

  // Log routing summary
  const sorted = Array.from(buckets.entries()).sort((a, b) => b[1] - a[1]);
  const summary = sorted.map(([k, v]) => `${k}:${v}`).join(' | ');
  if (summary) {
    logInfo(`Routing: ${summary}`);
  }

  // Update state
  if (!args.dryRun && !args.reportOnly && args.sinceDays === null) {
    state.lastConvIdx = maxShadowIdx;
    if (maxGanttsyWorkspaceModifiedTime) {
      state.lastGanttsyWorkspaceModifiedTime = maxGanttsyWorkspaceModifiedTime;
    }
    saveState(state);
  }

  // Spawn coaching agent if needed
  if (coachingPaths.length > 0 && !args.dryRun && !args.reportOnly) {
    spawnCoachingAnalysis(coachingPaths);
  }

  // Post pending action items summary to #sysops for human approval
  if (pendingMeetings.length > 0 && !args.dryRun && !args.reportOnly) {
    postPendingSummaryToSysops(pendingMeetings);
  }

  logInfo(`Done. processed=${toProcess.length} exported=${exported} coaching=${coachingPaths.length} work=${workPaths.length} pending=${pendingMeetings.length} deduped_shadow=${dedupedShadowIds.length}`);

  // Output written file paths to stdout so the shell wrapper can git-add only these files
  const allWrittenPaths = [...coachingPaths, ...workPaths];
  if (allWrittenPaths.length > 0) {
    console.log(JSON.stringify({ writtenFiles: allWrittenPaths }));
  }
}

main().catch(err => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
