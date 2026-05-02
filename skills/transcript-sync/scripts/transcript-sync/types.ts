/**
 * Type definitions for transcript-sync
 */

export interface State {
  skippedConvs?: number[];
  skippedGanttsyWorkspaceIds?: string[];
}

export interface ProcessedEntry {
  mtimeMs: number;
  clientAnalysis: boolean;
  coachAnalysis: boolean;
  updatedAt: string;
  note?: string;
}

export interface ProcessedTranscripts {
  processed: Record<string, ProcessedEntry>;
}

export interface Attendee {
  name: string;
  email: string;
  isSelf: number;
  source: string;
}

export interface CalendarMeta {
  calendar_id: string;
  event_id: string;
  event_title: string;
  event_start: string;
  event_description: string;
  attendee_names: string[];
}

export interface CalendarEvent {
  calendarId: string;
  eventId: string;
  title: string;
  start: Date;
  end: Date;
  attendees: Attendee[];
  description: string;
  attendeeNames: string[];
}

export interface MatchResult {
  event: CalendarEvent | null;
  org: string | null;
  confidence: number;
  method: 'auto' | 'llm' | 'none';
  reason: string;
}

export interface ClassificationResult {
  targetDir: string;
  reason: string;
}

export interface ClassificationContext {
  title: string;
  titleLower: string;
  emails: string[];
  names: string[];
  nonself: Attendee[];
  nonselfEmails: string[];
  nonselfNames: string[];
  gcalTitle: string;
  gcalDescription: string;
  gcalCalendarId: string;
}

export type ClassificationRule = (ctx: ClassificationContext) => ClassificationResult | null;

export interface ConversationRow {
  convIdx: number;
  convUuid: string;
  convTitle: string;
  convStartedAt: string;
  convEndedAt: string;
  convCreatedAt: string;
}

export interface TranscriptRow {
  transStartedAt: string;
  transEndedAt: string;
  transContent: string;
  spkrName: string;
}

export interface GanttsyWorkspaceDoc {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink: string;
}

export interface GanttsyWorkspaceTab {
  tabId: string;
  title: string;
  index: number;
}

export interface UnifiedMeeting {
  source: 'shadow' | 'ganttsy_workspace';
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  gcalEventId: string | null;
  attendees: Attendee[];
  gcalMeta: CalendarMeta | null;
  matchResult?: MatchResult;
  transcriptExcerpt?: string;
  shadowData?: ConversationRow;
  shadowTranscriptRows?: TranscriptRow[];
  ganttsyWorkspaceData?: {
    doc: GanttsyWorkspaceDoc;
    transcript: string;
  };
}

export interface ProcessMeetingResult {
  wrote: boolean;
  path?: string;
  skipped?: boolean;
  reason?: string;
}

export interface PendingActionItem {
  index: number;
  title: string;
  context: string;
  assignee: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  project: string;
}

export interface PendingMeeting {
  id: string;
  meetingTitle: string;
  meetingDate: string;
  org: string;
  sourceRel: string;
  targetDir: string;
  transcriptPath: string;
  lineageTag: string;
  actions: PendingActionItem[];
  createdAt: string;
  status: 'pending' | 'processing' | 'completed' | 'skipped';
  processedAt?: string;
  processedItems?: number[];
}

export interface Args {
  limit: number;
  sinceDays: number;
  shadowOnly: boolean;
  ganttsyWorkspaceOnly: boolean;
  dryRun: boolean;
  reportOnly: boolean;
  force: boolean;
  noCalendar: boolean;
  calendarIds: string[];
  calendarWindowMinutes: number;
  tasksMode: string;
  tasksMinConfidence: number;
  tasksMaxItems: number;
}
