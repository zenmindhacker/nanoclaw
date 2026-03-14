/**
 * Type definitions for transcript-sync
 */

export interface State {
  lastConvIdx: number;
  lastGanttsyWorkspaceModifiedTime: string | null;
  lastPlaudStartTime: number | null; // epoch ms from Plaud API
  skippedConvs?: number[];
  skippedGanttsyWorkspaceIds?: string[];
  skippedPlaudIds?: string[];
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

export interface PlaudFile {
  id: string;
  filename: string;
  duration: number; // milliseconds
  start_time: number; // epoch ms
}

export interface PlaudTranscriptSegment {
  content: string;
  start_time: number; // milliseconds offset
  end_time: number;
  speaker: string; // named speaker (e.g. "Cian")
  original_speaker: string; // diarization label (e.g. "Speaker 1")
}

export interface UnifiedMeeting {
  source: 'shadow' | 'ganttsy_workspace' | 'plaud';
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  gcalEventId: string | null;
  attendees: Attendee[];
  gcalMeta: CalendarMeta | null;
  shadowData?: ConversationRow;
  shadowTranscriptRows?: TranscriptRow[];
  ganttsyWorkspaceData?: {
    doc: GanttsyWorkspaceDoc;
    transcript: string;
  };
  plaudData?: {
    file: PlaudFile;
    segments: PlaudTranscriptSegment[];
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
  sinceDays: number | null;
  shadowOnly: boolean;
  ganttsyWorkspaceOnly: boolean;
  plaudOnly: boolean;
  dryRun: boolean;
  reportOnly: boolean;
  calendarFallback: boolean;
  calendarIds: string[];
  calendarWindowMinutes: number;
  tasksMode: string;
  tasksMinConfidence: number;
  tasksMaxItems: number;
}
