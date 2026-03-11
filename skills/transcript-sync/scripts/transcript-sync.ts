#!/usr/bin/env node
import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { google } from 'googleapis';

// Import from modular config
import {
  SHADOW_DB_PATH as DB_PATH,
  STATE_PATH,
  GITHUB_ROOT,
  COACHING_ROOT,
  KEVIN_COACHING_TRANSCRIPTS,
  CHRISTINA_COACHING_TRANSCRIPTS,
  GOOGLE_TOKEN,
  GOOGLE_OAUTH_CLIENT,
  TRANSCRIPT_TASKS_SCRIPT as TRANSCRIPT_TASKS_SCRIPT_TS,
  COACHING_SKILL_CLIENT,
  COACHING_SKILL_COACH,
  FATHOM_API_KEY_PATH,
  GANTTSY_WORKSPACE_FOLDER,
  GANTTSY_GOOGLE_TOKEN,
  GANTTSY_GOOGLE_OAUTH_CLIENT,
  DEFAULT_CALENDAR_IDS,
  LOG_FILE,
  PROCESSED_TRANSCRIPTS_PATH,
  COACH_ANALYSIS_ROOT,
  SELF_EMAILS,
  CONFIDENTIALITY_TRIGGERS,
  MIN_TRANSCRIPT_ROWS,
  MIN_ENDED_AGO_MS,
  DEDUP_TIME_WINDOW_MS,
  COACHING_AGENT_TIMEOUT_SECONDS,
} from './transcript-sync/config.js';

function log(level: 'INFO' | 'ERROR' | 'WARN', message: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // ignore append failures
  }
}

function logInfo(msg: string): void { log('INFO', msg); }
function logError(msg: string): void { log('ERROR', msg); }
function logWarn(msg: string): void { log('WARN', msg); }

// PROCESSED_TRANSCRIPTS_PATH and COACH_ANALYSIS_ROOT now imported from config

interface ProcessedEntry {
  mtimeMs: number;
  clientAnalysis: boolean;
  coachAnalysis: boolean;
  updatedAt: string;
  note?: string;
}

interface ProcessedTranscripts {
  processed: Record<string, ProcessedEntry>;
}

/**
 * Validate coaching analysis completeness and return paths needing re-analysis.
 * Checks that transcripts marked as processed actually have the expected output files.
 */
function validateCoachingAnalysis(): string[] {
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

interface State {
  lastConvIdx: number;
  lastFathomCreatedAt: string | null;
  lastGanttsyWorkspaceModifiedTime: string | null;
  skippedConvs?: number[];
  skippedFathomIds?: string[];
  skippedGanttsyWorkspaceIds?: string[];
}

// CONFIDENTIALITY_TRIGGERS now imported from config

function hasConfidentialityTrigger(text: string): boolean {
  return CONFIDENTIALITY_TRIGGERS.test(text);
}

function confirmConfidentialWithLLM(transcript: string, title: string): boolean {
  const sample = transcript.slice(0, 2000);
  const prompt = `Analyze this transcript excerpt. Did someone explicitly request confidentiality or ask not to record/share this conversation?

Title: ${title}
Excerpt:
${sample}

Respond with ONLY one word: CONFIDENTIAL or OK`;

  const tmpFile = '/tmp/.confidential-check-prompt.txt';

  try {
    writeFileSync(tmpFile, prompt);
    const cmd = `claude --print "$(cat '${tmpFile}')" 2>&1`;
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 60000, shell: '/bin/bash' }).trim();
    const lastLine = result.split('\n').pop() || '';
    return lastLine.toUpperCase().includes('CONFIDENTIAL');
  } catch (error: any) {
    logWarn(`[confidential] LLM check failed, defaulting to OK: ${error.message}`);
    return false;
  }
}

interface Attendee {
  name: string;
  email: string;
  isSelf: number;
  source: string;
}

interface CalendarMeta {
  calendar_id: string;
  event_id: string;
  event_title: string;
  event_start: string;
  event_description: string;
  attendee_names: string[];
}

interface ClassificationResult {
  targetDir: string;
  reason: string;
}

interface ConversationRow {
  convIdx: number;
  convUuid: string;
  convTitle: string;
  convStartedAt: string;
  convEndedAt: string;
  convCreatedAt: string;
}

interface TranscriptRow {
  transStartedAt: string;
  transEndedAt: string;
  transContent: string;
  spkrName: string;
}

// Fathom API types
interface FathomMeeting {
  recording_id: number;
  title: string;
  meeting_title: string;
  url: string;
  share_url: string;
  created_at: string;
  scheduled_start_time: string;
  scheduled_end_time: string;
  recording_start_time: string;
  recording_end_time: string;
  calendar_invitees: FathomInvitee[];
  transcript?: FathomTranscriptEntry[];
}

interface FathomInvitee {
  name: string;
  email: string;
  email_domain: string;
  is_external: boolean;
  matched_speaker_display_name?: string;
}

interface FathomTranscriptEntry {
  speaker: {
    display_name: string;
    matched_calendar_invitee_email?: string;
  };
  text: string;
  timestamp: string;
}

interface FathomListResponse {
  items: FathomMeeting[];
  next_cursor?: string;
  limit: number;
}

// Ganttsy Google Workspace types
interface GanttsyWorkspaceDoc {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink: string;
}

interface GanttsyWorkspaceTab {
  tabId: string;
  title: string;
  index: number;
}

// Unified meeting representation for deduplication
interface UnifiedMeeting {
  source: 'fathom' | 'shadow' | 'ganttsy_workspace';
  id: string; // fathom recording_id, shadow convIdx, or ganttsy workspace doc id
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  gcalEventId: string | null;
  attendees: Attendee[];
  gcalMeta: CalendarMeta | null;
  // Source-specific data
  fathomData?: FathomMeeting;
  shadowData?: ConversationRow;
  shadowTranscriptRows?: TranscriptRow[];
  ganttsyWorkspaceData?: { doc: GanttsyWorkspaceDoc; transcript: string };
}

function ensureState(): void {
  const dir = join(homedir(), '.openclaw/workspace/state');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(STATE_PATH)) {
    // Migrate from old shadow-sync state if exists
    const oldStatePath = join(homedir(), '.openclaw/workspace/state/shadow-sync-state.json');
    if (existsSync(oldStatePath)) {
      const oldState = JSON.parse(readFileSync(oldStatePath, 'utf-8'));
      const newState: State = {
        lastConvIdx: oldState.lastConvIdx || 0,
        lastFathomCreatedAt: null,
        lastGanttsyWorkspaceModifiedTime: null,
        skippedConvs: oldState.skippedConvs || [],
        skippedFathomIds: [],
        skippedGanttsyWorkspaceIds: [],
      };
      writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2));
      logInfo(`Migrated state from shadow-sync-state.json`);
    } else {
      writeFileSync(STATE_PATH, JSON.stringify({ 
        lastConvIdx: 0, 
        lastFathomCreatedAt: null,
        lastGanttsyWorkspaceModifiedTime: null,
        skippedConvs: [],
        skippedFathomIds: [],
        skippedGanttsyWorkspaceIds: [],
      }, null, 2));
    }
  }
}

function loadState(): State {
  ensureState();
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  // Ensure all fields exist
  return {
    lastConvIdx: state.lastConvIdx || 0,
    lastFathomCreatedAt: state.lastFathomCreatedAt || null,
    lastGanttsyWorkspaceModifiedTime: state.lastGanttsyWorkspaceModifiedTime || null,
    skippedConvs: state.skippedConvs || [],
    skippedFathomIds: state.skippedFathomIds || [],
    skippedGanttsyWorkspaceIds: state.skippedGanttsyWorkspaceIds || [],
  };
}

function saveState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function slugify(text: string): string {
  const slug = text
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return slug || 'meeting';
}

function parseShadowDt(isoNoTz: string): Date {
  // Shadow stores timestamps without timezone - interpret as local
  return new Date(isoNoTz);
}

function fetchAttendees(db: Database.Database, convUuid: string): Attendee[] {
  const rows = db.prepare(`
    SELECT COALESCE(displayName, '') as displayName,
           COALESCE(email, '') as email,
           COALESCE(isSelf, 0) as isSelf
    FROM SHADOW_ATTENDEE
    WHERE convUuid = ?
  `).all(convUuid) as any[];

  return rows.map(r => ({
    name: (r.displayName || '').trim(),
    email: (r.email || '').trim().toLowerCase(),
    isSelf: parseInt(r.isSelf || '0'),
    source: 'shadow',
  }));
}

function getCalendarService() {
  if (!existsSync(GOOGLE_TOKEN) || !existsSync(GOOGLE_OAUTH_CLIENT)) {
    return null;
  }
  try {
    const token = JSON.parse(readFileSync(GOOGLE_TOKEN, 'utf-8'));
    const rawClient = JSON.parse(readFileSync(GOOGLE_OAUTH_CLIENT, 'utf-8'));
    const client = rawClient.installed || rawClient.web || rawClient;
    const auth = new google.auth.OAuth2(client.client_id, client.client_secret, 'http://localhost');
    auth.setCredentials(token);
    return google.calendar({ version: 'v3', auth });
  } catch {
    return null;
  }
}

async function assertCalendarAuthHealthy(service: any, calendarIds: string[]): Promise<void> {
  if (!service) {
    throw new Error('GCAL_AUTH_FAILURE: google-token.json missing or unreadable');
  }

  let lastErr = 'unknown';
  for (const calId of calendarIds) {
    try {
      await service.events.list({
        calendarId: calId,
        timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 1,
      });
      return; // at least one calendar succeeds => auth/path healthy
    } catch (err: any) {
      const msg = err?.message || String(err);
      const code = err?.code ? ` code=${err.code}` : '';
      lastErr = `${msg}${code}`;
      continue;
    }
  }

  throw new Error(`GCAL_AUTH_FAILURE: all calendar probes failed (${lastErr})`);
}

function extractEmailsFromDescription(desc: string): string[] {
  if (!desc) return [];
  
  let txt = desc
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  txt = txt.replace(/<br\s*\/?>/gi, '\n');
  txt = txt.replace(/<[^>]+>/g, ' ');
  
  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const matches = txt.match(emailRegex) || [];
  
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of matches) {
    const em = email.trim().toLowerCase();
    if (!seen.has(em)) {
      seen.add(em);
      out.push(em);
    }
  }
  return out;
}

async function calendarFallbackAttendees(
  service: any,
  convStartedAt: string,
  convTitle: string,
  calendarIds: string[],
  windowMinutes: number
): Promise<[Attendee[], CalendarMeta | null]> {
  if (!service) {
    return [[], null];
  }

  let center: Date;
  try {
    center = new Date(convStartedAt);
  } catch {
    return [[], null];
  }

  const tMin = new Date(center.getTime() - windowMinutes * 60 * 1000).toISOString();
  const tMax = new Date(center.getTime() + windowMinutes * 60 * 1000).toISOString();

  let best: any = null;
  let bestScore = -1;

  const titleL = (convTitle || '').toLowerCase();
  const titleTokens = new Set((titleL.match(/[a-z0-9]+/g) || []));

  for (const calId of calendarIds) {
    try {
      const response = await service.events.list({
        calendarId: calId,
        timeMin: tMin,
        timeMax: tMax,
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 20,
      });

      const events = response.data.items || [];
      for (const ev of events) {
        const evTitle = (ev.summary || '').toLowerCase();
        const evTokens = new Set((evTitle.match(/[a-z0-9]+/g) || []));
        
        const intersection = new Set([...titleTokens].filter(x => evTokens.has(x)));
        let titleScore = intersection.size;
        
        if (titleScore === 0 && evTitle && titleL && (evTitle.slice(0, 20).includes(titleL.slice(0, 20)) || titleL.slice(0, 20).includes(evTitle.slice(0, 20)))) {
          titleScore = 1;
        }
        
        // Calculate time proximity score (closer to center = higher score)
        const evStart = new Date(ev.start?.dateTime || ev.start?.date || 0).getTime();
        const timeDiff = Math.abs(evStart - center.getTime());
        const maxDiff = windowMinutes * 60 * 1000;
        const timeScore = Math.max(0, 1 - (timeDiff / maxDiff)); // 0-1, higher = closer
        
        // Combined score: time proximity is primary, title match is secondary bonus
        const score = timeScore + (titleScore * 0.1);
        
        if (score > bestScore) {
          bestScore = score;
          best = { calId, ev };
        }
      }
    } catch {
      continue;
    }
  }

  if (!best) {
    return [[], null];
  }

  const { calId, ev } = best;
  const out: Attendee[] = [];
  
  for (const a of ev.attendees || []) {
    out.push({
      name: (a.displayName || '').trim(),
      email: (a.email || '').trim().toLowerCase(),
      isSelf: a.self ? 1 : 0,
      source: 'gcal',
    });
  }

  // Extract emails from description
  for (const em of extractEmailsFromDescription(ev.description || '')) {
    const selfEmails = ['cian@cognitivetech.net', 'cian@ganttsy.com'];
    out.push({
      name: '',
      email: em,
      isSelf: selfEmails.includes(em) ? 1 : 0,
      source: 'gcal_description',
    });
  }

  const meta: CalendarMeta = {
    calendar_id: calId,
    event_id: ev.id || '',
    event_title: ev.summary || '',
    event_start: (ev.start?.dateTime || ev.start?.date || ''),
    event_description: (ev.description || '').trim(),
    attendee_names: (ev.attendees || [])
      .map((a: any) => (a.displayName || a.email || '').trim())
      .filter(Boolean),
  };

  return [out, meta];
}

interface ClassificationContext {
  title: string;
  titleLower: string;
  emails: string[];
  names: string[];
  nonself: Attendee[];
  nonselfEmails: string[];
  nonselfNames: string[];
  gcalTitle: string;
  gcalDescription: string;
}

type ClassificationRule = (ctx: ClassificationContext) => ClassificationResult | null;

// ============================================================================
// ROUTING RULES
// Priority: 1) Coaching clients  2) Cian's account  3) Default to CTCI
// ============================================================================

const COACHING_RULES: ClassificationRule[] = [
  // Christina coaching (uses personal gmail or ctci account)
  (ctx) => {
    if (ctx.emails.includes('christina3lane@gmail.com')) {
      return { targetDir: CHRISTINA_COACHING_TRANSCRIPTS, reason: 'coaching:christina_email' };
    }
    if (ctx.gcalTitle.includes('christina lane and cian') && ctx.gcalDescription.includes('zen transurfing')) {
      return { targetDir: CHRISTINA_COACHING_TRANSCRIPTS, reason: 'coaching:christina_gcal' };
    }
    return null;
  },
  // Kevin coaching (uses personal or ctci account)
  (ctx) => {
    const hasKevin =
      ctx.emails.some(e => ['ktlee@pwcpa.ca', 'kevin@kevintlee.ca'].includes(e)) ||
      ctx.emails.some(e => e.includes('kevin') && e.includes('lee')) ||
      ctx.names.some(n => n.includes('kevin') && n.includes('lee'));
    return hasKevin ? { targetDir: KEVIN_COACHING_TRANSCRIPTS, reason: 'coaching:kevin_attendee' } : null;
  },
];

// Helper: Determine Ganttsy sub-routing (strategy vs team)
function classifyGanttsySubRoute(ctx: ClassificationContext): ClassificationResult {
  const ganttsyTeam = ['bart@ganttsy.com', 'rustam@ganttsy.com', 'vergel@ganttsy.com', 'aby@ganttsy.com'];
  const isOneOnOne = ctx.nonself.length === 1 && ctx.nonselfEmails.some(e => ganttsyTeam.includes(e));
  const strategyKeywords = ['strategy', 'interview', 'candidate', 'hiring', 'debrief', 'business', 'investor', 'funding', 'pitch', '1:1', '1-1', 'one on one'];
  const combined = `${ctx.titleLower} ${ctx.gcalTitle}`;
  const hasStrategyKeyword = strategyKeywords.some(k => combined.includes(k));
  
  if (isOneOnOne || hasStrategyKeyword) {
    return { targetDir: join(GITHUB_ROOT, 'ganttsy/ganttsy-strategy/transcripts'), reason: 'ganttsy:strategy' };
  }
  return { targetDir: join(GITHUB_ROOT, 'ganttsy/ganttsy-docs/planning/transcripts'), reason: 'ganttsy:team' };
}

// Primary routing: Which Cian account is in the calendar event?
const CIAN_ACCOUNT_RULES: ClassificationRule[] = [
  // cian@copperteams.ai → CopperTeams
  (ctx) => ctx.emails.includes('cian@copperteams.ai')
    ? { targetDir: join(GITHUB_ROOT, 'copperteams/ct-docs/planning/transcripts'), reason: 'cian_account:copperteams' }
    : null,
  // cian@ganttsy.com → Ganttsy (with sub-routing)
  (ctx) => ctx.emails.includes('cian@ganttsy.com')
    ? classifyGanttsySubRoute(ctx)
    : null,
  // cian.whalley@newvaluegroup.com or cian@newvaluegroup.com → NVS
  (ctx) => (ctx.emails.includes('cian.whalley@newvaluegroup.com') || ctx.emails.includes('cian@newvaluegroup.com'))
    ? { targetDir: join(GITHUB_ROOT, 'nvs/nvs-docs/transcripts'), reason: 'cian_account:nvs' }
    : null,
];

function classifyTarget(title: string, attendees: Attendee[], gcalMeta: CalendarMeta | null = null): ClassificationResult {
  const nonself = attendees.filter(a => !a.isSelf);
  const ctx: ClassificationContext = {
    title,
    titleLower: (title || '').toLowerCase(),
    emails: attendees.filter(a => a.email).map(a => a.email),
    names: attendees.filter(a => a.name).map(a => a.name.toLowerCase()),
    nonself,
    nonselfEmails: nonself.filter(a => a.email).map(a => a.email),
    nonselfNames: nonself.filter(a => a.name).map(a => a.name.toLowerCase()),
    gcalTitle: (gcalMeta?.event_title || '').toLowerCase(),
    gcalDescription: (gcalMeta?.event_description || '').toLowerCase(),
  };

  // 1) Coaching clients (highest priority)
  for (const rule of COACHING_RULES) {
    const result = rule(ctx);
    if (result) return result;
  }
  
  // 2) Cian's account determines org
  for (const rule of CIAN_ACCOUNT_RULES) {
    const result = rule(ctx);
    if (result) return result;
  }

  // 3) Default to CTCI (no calendar match or cian@cognitivetech.net)
  return { targetDir: join(GITHUB_ROOT, 'cognitivetech/ctci-docs/transcripts'), reason: 'default:ctci' };
}

function fetchTranscriptRows(db: Database.Database, convIdx: number): TranscriptRow[] {
  const rows = db.prepare(`
    SELECT t.transStartedAt, t.transEndedAt, t.transContent, COALESCE(s.spkrName,'') as spkrName
    FROM SHADOW_TRANSCRIPT t
    LEFT JOIN SHADOW_SPEAKER s ON s.spkrIdx = t.spkrIdx
    WHERE t.convIdx = ?
    ORDER BY t.transIdx ASC
  `).all(convIdx) as any[];

  return rows.map(r => ({
    transStartedAt: r.transStartedAt,
    transEndedAt: r.transEndedAt,
    transContent: r.transContent || '',
    spkrName: r.spkrName || '',
  }));
}

function mergeAttendees(shadowAttendees: Attendee[], gcalAttendees: Attendee[]): Attendee[] {
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

function isLikelyKevinCoachingFromContent(title: string, transcriptText: string): boolean {
  const t = (title || '').toLowerCase();
  const genericTitle = /^conversation\s+\d+$/i.test(title || '');
  if (!genericTitle && !t.includes('coaching')) return false;

  const blob = transcriptText.toLowerCase();

  const signals = [
    'black hand',
    'als',
    'pwa',
    'cpa',
    'peter',
    'gratitude practice',
    'switch to bi-weekly',
    'container'
  ];

  const hits = signals.filter(s => blob.includes(s)).length;
  return hits >= 2;
}

async function runTranscriptToLinear(
  transcriptPath: string,
  tasksMode: string,
  minConfidence: number,
  maxItems: number
): Promise<void> {
  if (tasksMode === 'off') {
    return;
  }

  const scriptPath = TRANSCRIPT_TASKS_SCRIPT_TS;

  if (!existsSync(scriptPath)) {
    logInfo(`[tasks] script missing: ${scriptPath}`);
    return;
  }

  try {
    // tsx is installed alongside the skill scripts in node_modules
    const tsxPath = join(dirname(scriptPath), '..', 'node_modules', '.bin', 'tsx');
    const cmd = `"${tsxPath}" "${scriptPath}" "${transcriptPath}" --mode ${tasksMode} --min-confidence ${minConfidence} --max-items ${maxItems}`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
    if (output.trim()) {
      logInfo(output.trim());
    }
  } catch (error: any) {
    if (error.stdout?.trim()) {
      logInfo(error.stdout.trim());
    }
    if (error.status !== 0 && error.stderr?.trim()) {
      logInfo(`[tasks] error: ${error.stderr.trim()}`);
    }
  }
}

// ============================================================================
// Fathom API Client
// ============================================================================

function getFathomApiKey(): string | null {
  if (!existsSync(FATHOM_API_KEY_PATH)) {
    return null;
  }
  try {
    return readFileSync(FATHOM_API_KEY_PATH, 'utf-8').trim();
  } catch {
    return null;
  }
}

async function fetchFathomMeetings(
  apiKey: string,
  createdAfter: string | null,
  limit: number = 50
): Promise<FathomMeeting[]> {
  const baseUrl = 'https://api.fathom.ai/external/v1/meetings';
  const params = new URLSearchParams();
  params.set('include_transcript', 'true');
  if (createdAfter) {
    params.set('created_after', createdAfter);
  }
  
  const allMeetings: FathomMeeting[] = [];
  let cursor: string | null = null;
  
  while (allMeetings.length < limit) {
    const url = cursor 
      ? `${baseUrl}?${params.toString()}&cursor=${cursor}`
      : `${baseUrl}?${params.toString()}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Fathom API error ${response.status}: ${text}`);
    }
    
    const data: FathomListResponse = await response.json();
    allMeetings.push(...data.items);
    
    if (!data.next_cursor || data.items.length === 0) {
      break;
    }
    cursor = data.next_cursor;
  }
  
  return allMeetings.slice(0, limit);
}

function fathomInviteesToAttendees(invitees: FathomInvitee[]): Attendee[] {
  const selfEmails = ['cian@cognitivetech.net', 'cian@ganttsy.com', 'cian.whalley@newvaluegroup.com'];
  return invitees.map(inv => ({
    name: inv.name || '',
    email: (inv.email || '').toLowerCase(),
    isSelf: selfEmails.includes((inv.email || '').toLowerCase()) ? 1 : 0,
    source: 'fathom',
  }));
}

function fathomTranscriptToText(transcript: FathomTranscriptEntry[]): string {
  return transcript.map(t => `${t.speaker.display_name || 'Speaker'}: ${t.text}`).join('\n');
}

// ============================================================================
// Ganttsy Google Workspace API Client
// ============================================================================

function getGanttsyDriveService() {
  if (!existsSync(GANTTSY_GOOGLE_TOKEN) || !existsSync(GANTTSY_GOOGLE_OAUTH_CLIENT)) {
    return null;
  }
  try {
    const token = JSON.parse(readFileSync(GANTTSY_GOOGLE_TOKEN, 'utf-8'));
    const rawClient = JSON.parse(readFileSync(GANTTSY_GOOGLE_OAUTH_CLIENT, 'utf-8'));
    const client = rawClient.installed || rawClient.web || rawClient;
    const auth = new google.auth.OAuth2(client.client_id, client.client_secret, client.redirect_uris?.[0] || 'http://localhost');
    auth.setCredentials(token);
    return { drive: google.drive({ version: 'v3', auth }), docs: google.docs({ version: 'v1', auth }) };
  } catch (err: any) {
    logError(`[ganttsy_workspace] Failed to init Google APIs: ${err.message}`);
    return null;
  }
}

async function fetchGanttsyWorkspaceDocs(
  modifiedAfter: string | null,
  limit: number = 50
): Promise<GanttsyWorkspaceDoc[]> {
  const services = getGanttsyDriveService();
  if (!services) {
    logWarn(`[ganttsy_workspace] OAuth credentials not found at ${GANTTSY_GOOGLE_TOKEN}`);
    return [];
  }

  try {
    let query = `'${GANTTSY_WORKSPACE_FOLDER}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.document'`;
    if (modifiedAfter) {
      query += ` and modifiedTime > '${modifiedAfter}'`;
    }
    
    const response = await services.drive.files.list({
      q: query,
      fields: 'files(id, name, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: limit,
    });
    
    const files = response.data.files || [];
    return files.map((f: any) => ({
      id: f.id || '',
      name: f.name || '',
      modifiedTime: f.modifiedTime || '',
      webViewLink: f.webViewLink || '',
    }));
  } catch (err: any) {
    logError(`[ganttsy_workspace] Failed to fetch docs: ${err.message}`);
    return [];
  }
}

async function fetchGanttsyWorkspaceTranscript(docId: string): Promise<string | null> {
  const services = getGanttsyDriveService();
  if (!services) {
    return null;
  }

  try {
    // Export document as plain text using Drive API
    const response = await services.drive.files.export(
      { fileId: docId, mimeType: 'text/plain' },
      { responseType: 'text' }
    );
    
    const content = response.data as string;
    if (!content || !content.trim()) {
      return null;
    }
    
    // The Gemini notes format embeds the transcript with speaker patterns
    // Look for lines with speaker patterns (Name: text)
    const lines = content.split('\n');
    const speakerPattern = /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*:\s*/;
    
    // Find where transcript actually starts (skip notes section at top)
    let transcriptStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (speakerPattern.test(lines[i])) {
        transcriptStart = i;
        break;
      }
    }
    
    if (transcriptStart === 0) {
      logInfo(`[ganttsy_workspace] Doc ${docId} has no speaker patterns`);
      return null;
    }
    
    // Find where transcript ends (look for "Transcription ended" or similar)
    let transcriptEnd = lines.length;
    for (let i = transcriptStart; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('transcription ended')) {
        transcriptEnd = i;
        break;
      }
    }
    
    // Extract transcript portion
    const transcriptLines = lines.slice(transcriptStart, transcriptEnd);
    const transcript = transcriptLines.join('\n').trim();
    
    return transcript || null;
  } catch (err: any) {
    logError(`[ganttsy_workspace] Failed to fetch transcript for ${docId}: ${err.message}`);
    return null;
  }
}

function parseGanttsyWorkspaceMeetingDate(docName: string, modifiedTime: string): Date {
  // Gemini notes format: "Meeting Name - 2026/02/23 11:27 EST - Notes by Gemini"
  const geminiMatch = docName.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s*(EST|CST|PST|UTC|EDT|CDT|PDT)?/i);
  if (geminiMatch) {
    const [, year, month, day, hour, minute, tz] = geminiMatch;
    
    // Map timezone abbreviations to UTC offsets (standard time)
    const tzOffsets: Record<string, number> = {
      'EST': -5, 'EDT': -4,
      'CST': -6, 'CDT': -5,
      'PST': -8, 'PDT': -7,
      'UTC': 0,
    };
    
    const offset = tzOffsets[(tz || 'EST').toUpperCase()] ?? -5;
    
    // Construct ISO string with timezone offset
    const sign = offset >= 0 ? '+' : '-';
    const absOffset = Math.abs(offset);
    const isoString = `${year}-${month}-${day}T${hour.padStart(2, '0')}:${minute}:00${sign}${String(absOffset).padStart(2, '0')}:00`;
    const date = new Date(isoString);
    
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Try simple YYYY-MM-DD format
  const dateMatch = docName.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    const date = new Date(dateMatch[1]);
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // Fallback to modified time
  return new Date(modifiedTime);
}

function parseGanttsyWorkspaceAttendees(content: string): string[] {
  // Extract attendees from the Notes section (before Transcript tab)
  // Look for common patterns like "Attendees:", "Invitees:", email addresses
  const emails: string[] = [];
  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const matches = content.match(emailRegex) || [];
  
  const seen = new Set<string>();
  for (const email of matches) {
    const em = email.trim().toLowerCase();
    if (!seen.has(em)) {
      seen.add(em);
      emails.push(em);
    }
  }
  
  return emails;
}

// ============================================================================
// Deduplication
// ============================================================================

// DEDUP_TIME_WINDOW_MS now imported from config

// Scan existing transcript files for gcal_event_ids (cross-run deduplication)
function scanExistingGcalEventIds(directories: string[]): Set<string> {
  const gcalEventIds = new Set<string>();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
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

const NAME_REPLACEMENTS: [RegExp, string][] = [
  [/Vveerrgg Eeee/g, 'Vergel'],
];

function normalizeNames(text: string): string {
  let result = text;
  for (const [pattern, replacement] of NAME_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function meetingsAreDuplicates(
  fathom: UnifiedMeeting,
  shadow: UnifiedMeeting
): boolean {
  // Method 1: Same gcal event_id (most reliable)
  if (fathom.gcalEventId && shadow.gcalEventId && fathom.gcalEventId === shadow.gcalEventId) {
    return true;
  }
  
  // Method 2: Start times within 5 minute window
  const timeDiff = Math.abs(fathom.startedAt.getTime() - shadow.startedAt.getTime());
  if (timeDiff <= DEDUP_TIME_WINDOW_MS) {
    return true;
  }
  
  return false;
}

// ============================================================================
// Main Processing
// ============================================================================

interface Args {
  dryRun: boolean;
  limit: number;
  sinceDays: number | null;
  reportOnly: boolean;
  calendarFallback: boolean;
  calendarWindowMinutes: number;
  calendarIds: string[];
  tasksMode: string;
  tasksMinConfidence: number;
  tasksMaxItems: number;
  fathomOnly: boolean;
  shadowOnly: boolean;
  ganttsyWorkspaceOnly: boolean;
}

function parseArgs(): Args {
  const args: Args = {
    dryRun: false,
    limit: 50,
    sinceDays: null,
    reportOnly: false,
    calendarFallback: false,
    calendarWindowMinutes: 10,
    calendarIds: DEFAULT_CALENDAR_IDS,
    tasksMode: 'auto',
    tasksMinConfidence: 0.72,
    tasksMaxItems: 6,
    fathomOnly: false,
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
    } else if (arg === '--calendar-fallback') {
      args.calendarFallback = true;
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
    } else if (arg === '--fathom-only') {
      args.fathomOnly = true;
    } else if (arg === '--shadow-only') {
      args.shadowOnly = true;
    } else if (arg === '--ganttsy-workspace-only') {
      args.ganttsyWorkspaceOnly = true;
    }
  }

  return args;
}

async function processMeeting(
  meeting: UnifiedMeeting,
  args: Args,
  state: State,
  service: any,
  coachingPaths: string[],
  workPaths: string[]
): Promise<{ wrote: boolean; path?: string }> {
  const title = meeting.title || `Meeting ${meeting.id}`;
  
  // Get transcript text for confidentiality check
  let transcriptText = '';
  if (meeting.source === 'fathom' && meeting.fathomData?.transcript) {
    transcriptText = fathomTranscriptToText(meeting.fathomData.transcript);
  } else if (meeting.source === 'shadow' && meeting.shadowTranscriptRows) {
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
      } else if (meeting.source === 'fathom') {
        state.skippedFathomIds = state.skippedFathomIds || [];
        state.skippedFathomIds.push(meeting.id);
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
  // If gcal matching failed and routing defaulted to CTCI, force to Ganttsy sub-route.
  if (meeting.source === 'ganttsy_workspace' && targetDir === ctciDir) {
    const ctx = {
      title,
      titleLower: title.toLowerCase(),
      emails: attendees.map((a: Attendee) => a.email).filter(Boolean),
      names: attendees.map((a: Attendee) => a.name?.toLowerCase()).filter(Boolean),
      nonself: attendees.filter((a: Attendee) => !a.isSelf),
      nonselfEmails: attendees.filter((a: Attendee) => !a.isSelf && a.email).map((a: Attendee) => a.email),
      nonselfNames: attendees.filter((a: Attendee) => !a.isSelf && a.name).map((a: Attendee) => a.name?.toLowerCase()),
      gcalTitle: (gcalMeta?.event_title || '').toLowerCase(),
      gcalDescription: (gcalMeta?.event_description || '').toLowerCase(),
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
  
  if (meeting.source === 'fathom' && meeting.fathomData) {
    lines.push(`- fathom_url: ${meeting.fathomData.url}`);
    lines.push(`- fathom_share_url: ${meeting.fathomData.share_url}`);
  }
  
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
  } else if (meeting.source === 'fathom' && meeting.fathomData?.transcript) {
    for (const t of meeting.fathomData.transcript) {
      const speaker = t.speaker.display_name || 'Speaker';
      const content = t.text.trim();
      if (!content) continue;
      lines.push(`- **${speaker}** [${t.timestamp}]: ${content}`);
    }
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
    await runTranscriptToLinear(
      outPath,
      args.tasksMode,
      args.tasksMinConfidence,
      args.tasksMaxItems
    );
  }
  
  return { wrote: true, path: outPath };
}

function spawnCoachingAnalysis(paths: string[]): void {
  const pathList = paths.join(', ');
  const jobName = `coaching-analysis-${Date.now()}`;
  const task = `Run coaching analysis on these new transcripts: ${pathList}

Skills:
- Client analysis: ${COACHING_SKILL_CLIENT}
- Coach analysis: ${COACHING_SKILL_COACH}

ORCHESTRATION PATTERN (hybrid model approach):
1. YOU (orchestrator): Read transcripts, read skill docs, plan the analysis
2. DELEGATE to writer subagent (Opus): Create all markdown output files
   - Use: claude --task "Write [file type] for [session]" --agent writer
   - Writer creates: session-insights, methodology, presence, quotes, client notes
3. YOU: Validate outputs, update processed-transcripts.json

Follow each skill doc exactly. All markdown files MUST be created by the writer subagent.

IMPORTANT: After writer completes files, update the processed-transcripts.json file at:
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
  logWarn(`[coaching] Run coaching analysis manually or trigger via main group.`);
}

async function main() {
  const args = parseArgs();
  const state = loadState();
  
  // ========================================================================
  // Validate previous coaching analysis completeness
  // ========================================================================
  const incompleteCoachingPaths = validateCoachingAnalysis();
  if (incompleteCoachingPaths.length > 0 && !args.dryRun && !args.reportOnly) {
    logInfo(`[validation] Triggering re-analysis for ${incompleteCoachingPaths.length} incomplete transcript(s)`);
    spawnCoachingAnalysis(incompleteCoachingPaths);
  }
  
  // Setup Google Calendar service
  const service = args.calendarFallback ? getCalendarService() : null;
  if (args.calendarFallback) {
    await assertCalendarAuthHealthy(service, args.calendarIds);
  }
  
  const ganttsyWorkspaceMeetings: UnifiedMeeting[] = [];
  const fathomMeetings: UnifiedMeeting[] = [];
  const shadowMeetings: UnifiedMeeting[] = [];
  
  // ========================================================================
  // Fetch Ganttsy Google Workspace meetings
  // ========================================================================
  if (!args.shadowOnly && !args.fathomOnly) {
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
        if (!transcript) {
          continue;
        }
        
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
  // Fetch Fathom meetings
  // ========================================================================
  if (!args.shadowOnly && !args.ganttsyWorkspaceOnly) {
    const fathomApiKey = getFathomApiKey();
    if (fathomApiKey) {
      try {
        let createdAfter: string | null = null;
        if (args.sinceDays !== null) {
          createdAfter = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString();
        } else if (state.lastFathomCreatedAt) {
          createdAfter = state.lastFathomCreatedAt;
        }
        
        const rawFathom = await fetchFathomMeetings(fathomApiKey, createdAfter, args.limit);
        const skippedFathomIds = new Set(state.skippedFathomIds || []);
        
        for (const fm of rawFathom) {
          if (skippedFathomIds.has(String(fm.recording_id))) {
            logInfo(`[skip] fathom=${fm.recording_id} previously marked confidential`);
            continue;
          }
          
          const attendees = fathomInviteesToAttendees(fm.calendar_invitees || []);
          
          // Try to match to gcal event
          let gcalMeta: CalendarMeta | null = null;
          let gcalAttendees: Attendee[] = [];
          if (service && fm.scheduled_start_time) {
            [gcalAttendees, gcalMeta] = await calendarFallbackAttendees(
              service,
              fm.scheduled_start_time,
              fm.meeting_title || fm.title,
              args.calendarIds,
              args.calendarWindowMinutes
            );
          }
          
          fathomMeetings.push({
            source: 'fathom',
            id: String(fm.recording_id),
            title: fm.meeting_title || fm.title,
            startedAt: new Date(fm.recording_start_time || fm.scheduled_start_time || fm.created_at),
            endedAt: fm.recording_end_time ? new Date(fm.recording_end_time) : null,
            gcalEventId: gcalMeta?.event_id || null,
            attendees: mergeAttendees(attendees, gcalAttendees),
            gcalMeta,
            fathomData: fm,
          });
        }
        
        logInfo(`[fathom] Fetched ${fathomMeetings.length} meeting(s)`);
      } catch (err: any) {
        logError(`[fathom] API error: ${err.message}`);
      }
    } else {
      logWarn(`[fathom] No API key found at ${FATHOM_API_KEY_PATH}`);
    }
  }
  
  // ========================================================================
  // Fetch Shadow meetings
  // ========================================================================
  if (!args.fathomOnly && !args.ganttsyWorkspaceOnly && existsSync(DB_PATH)) {
    const db = new Database(DB_PATH, { readonly: true });
    const lastIdx = state.lastConvIdx;
    
    let convs: ConversationRow[];
    if (args.sinceDays !== null) {
      convs = db.prepare(`
        SELECT convIdx, convUuid, convTitle, convStartedAt, convEndedAt, convCreatedAt
        FROM SHADOW_CONVERSATION
        WHERE datetime(replace(substr(convStartedAt,1,19),'T',' ')) >= datetime('now', ?)
          AND convEndedAt IS NOT NULL
        ORDER BY convIdx ASC
        LIMIT ?
      `).all(`-${args.sinceDays} days`, args.limit) as any[];
    } else {
      convs = db.prepare(`
        SELECT convIdx, convUuid, convTitle, convStartedAt, convEndedAt, convCreatedAt
        FROM SHADOW_CONVERSATION
        WHERE convIdx > ?
          AND convEndedAt IS NOT NULL
        ORDER BY convIdx ASC
        LIMIT ?
      `).all(lastIdx, args.limit) as any[];
    }
    
    const skippedConvs = new Set(state.skippedConvs || []);
    
    const MIN_TRANSCRIPT_ROWS = 10; // Minimum rows to consider transcript complete
    const MIN_ENDED_AGO_MS = 5 * 60 * 1000; // Must have ended at least 5 minutes ago
    
    for (const c of convs) {
      if (skippedConvs.has(c.convIdx)) {
        logInfo(`[skip] shadow=${c.convIdx} previously marked confidential`);
        continue;
      }
      
      // Check if meeting ended long enough ago to be complete
      if (c.convEndedAt) {
        const endedAt = parseShadowDt(c.convEndedAt);
        const endedAgoMs = Date.now() - endedAt.getTime();
        if (endedAgoMs < MIN_ENDED_AGO_MS) {
          logInfo(`[skip] shadow=${c.convIdx} ended only ${Math.round(endedAgoMs / 1000)}s ago, waiting for completion`);
          continue;
        }
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
  } else if (!args.fathomOnly) {
    logWarn(`[shadow] DB not found at ${DB_PATH}`);
  }
  
  // ========================================================================
  // Deduplicate: prioritize Ganttsy Workspace > Fathom > Shadow
  // ========================================================================
  
  // Pre-scan existing transcript files for cross-run deduplication
  const transcriptDirs = [
    join(GITHUB_ROOT, 'ganttsy/ganttsy-docs/planning/transcripts'),
    join(GITHUB_ROOT, 'ganttsy/ganttsy-strategy/transcripts'),
    join(GITHUB_ROOT, 'copperteams/ct-docs/planning/transcripts'),
    join(GITHUB_ROOT, 'cognitivetech/ctci-docs/transcripts'),
    join(GITHUB_ROOT, 'nvs/nvs-docs/transcripts'),
    KEVIN_COACHING_TRANSCRIPTS,
    CHRISTINA_COACHING_TRANSCRIPTS,
  ];
  const existingGcalEventIds = scanExistingGcalEventIds(transcriptDirs);
  if (existingGcalEventIds.size > 0) {
    logInfo(`[dedup] Found ${existingGcalEventIds.size} existing gcal_event_ids from previous runs`);
  }
  
  const processedGcalEventIds = new Set<string>(existingGcalEventIds);
  const processedTimeWindows: Date[] = [];
  
  const toProcess: UnifiedMeeting[] = [];
  const dedupedFathomIds: string[] = [];
  const dedupedShadowIds: string[] = [];
  
  // Add all Ganttsy Workspace meetings first (highest priority for Ganttsy meetings)
  const dedupedGanttsyWorkspaceIds: string[] = [];
  for (const gw of ganttsyWorkspaceMeetings) {
    // Check if already processed in a previous run
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
  
  // Add Fathom meetings only if no Ganttsy Workspace duplicate
  for (const fm of fathomMeetings) {
    // Check gcal event_id match
    if (fm.gcalEventId && processedGcalEventIds.has(fm.gcalEventId)) {
      logInfo(`[dedup] fathom=${fm.id} matches ganttsy_workspace by gcal_event_id=${fm.gcalEventId}, skipping`);
      dedupedFathomIds.push(fm.id);
      continue;
    }
    
    // Check time window overlap
    const isDuplicate = processedTimeWindows.some(gwTime => {
      const diff = Math.abs(fm.startedAt.getTime() - gwTime.getTime());
      return diff <= DEDUP_TIME_WINDOW_MS;
    });
    
    if (isDuplicate) {
      logInfo(`[dedup] fathom=${fm.id} matches ganttsy_workspace by time window, skipping`);
      dedupedFathomIds.push(fm.id);
      continue;
    }
    
    toProcess.push(fm);
    if (fm.gcalEventId) {
      processedGcalEventIds.add(fm.gcalEventId);
    }
    processedTimeWindows.push(fm.startedAt);
  }
  
  // Add Shadow meetings only if no Ganttsy Workspace or Fathom duplicate
  for (const sm of shadowMeetings) {
    // Check gcal event_id match
    if (sm.gcalEventId && processedGcalEventIds.has(sm.gcalEventId)) {
      logInfo(`[dedup] shadow=${sm.id} matches higher priority source by gcal_event_id=${sm.gcalEventId}, skipping`);
      dedupedShadowIds.push(sm.id);
      continue;
    }
    
    // Check time window overlap
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
  
  logInfo(`Processing ${toProcess.length} meeting(s) (deduped ${dedupedFathomIds.length} fathom, ${dedupedShadowIds.length} shadow)`);
  
  // ========================================================================
  // Process meetings
  // ========================================================================
  const buckets: Map<string, number> = new Map();
  const coachingPaths: string[] = [];
  const workPaths: string[] = [];
  let exported = 0;
  let maxShadowIdx = state.lastConvIdx;
  let maxFathomCreatedAt = state.lastFathomCreatedAt;
  let maxGanttsyWorkspaceModifiedTime = state.lastGanttsyWorkspaceModifiedTime;
  
  for (const meeting of toProcess) {
    const result = await processMeeting(meeting, args, state, service, coachingPaths, workPaths);
    
    if (result.wrote) {
      exported++;
      // Track routing buckets (extract targetDir from path)
      if (result.path) {
        const dir = result.path.substring(0, result.path.lastIndexOf('/'));
        buckets.set(dir, (buckets.get(dir) || 0) + 1);
      }
    }
    
    // Update watermarks
    if (meeting.source === 'shadow') {
      maxShadowIdx = Math.max(maxShadowIdx, parseInt(meeting.id));
    } else if (meeting.source === 'fathom' && meeting.fathomData) {
      const createdAt = meeting.fathomData.created_at;
      if (!maxFathomCreatedAt || createdAt > maxFathomCreatedAt) {
        maxFathomCreatedAt = createdAt;
      }
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
    if (maxFathomCreatedAt) {
      state.lastFathomCreatedAt = maxFathomCreatedAt;
    }
    if (maxGanttsyWorkspaceModifiedTime) {
      state.lastGanttsyWorkspaceModifiedTime = maxGanttsyWorkspaceModifiedTime;
    }
    saveState(state);
  }
  
  // Spawn coaching agent if needed
  if (coachingPaths.length > 0 && !args.dryRun && !args.reportOnly) {
    spawnCoachingAnalysis(coachingPaths);
  }
  
  logInfo(`Done. processed=${toProcess.length} exported=${exported} coaching=${coachingPaths.length} work=${workPaths.length} deduped_fathom=${dedupedFathomIds.length} deduped_shadow=${dedupedShadowIds.length}`);
}

main().catch(err => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
