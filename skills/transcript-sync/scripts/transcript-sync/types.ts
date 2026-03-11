/**
 * Type definitions for transcript-sync
 */

export interface State {
  lastConvIdx: number;
  lastFathomCreatedAt: string | null;
  lastGanttsyWorkspaceModifiedTime: string | null;
  skippedConvs?: number[];
  skippedFathomIds?: string[];
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

export interface ClassificationResult {
  targetDir: string;
  reason: string;
}

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

export interface FathomMeeting {
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

export interface FathomInvitee {
  name: string;
  email: string;
  email_domain: string;
  is_external: boolean;
  matched_speaker_display_name?: string;
}

export interface FathomTranscriptEntry {
  speaker: {
    display_name: string;
    matched_calendar_invitee_email?: string;
  };
  text: string;
  timestamp: string;
}

export interface FathomListResponse {
  items: FathomMeeting[];
  next_cursor?: string;
}

export interface GanttsyWorkspaceDoc {
  id: string;
  name: string;
  modifiedTime: string;
  mimeType: string;
}

export interface UnifiedMeeting {
  source: 'shadow' | 'fathom' | 'ganttsy_workspace';
  id: string;
  title: string;
  startedAt: Date;
  endedAt: Date | null;
  gcalEventId: string | null;
  attendees: Attendee[];
  gcalMeta: CalendarMeta | null;
  shadowData?: ConversationRow;
  shadowTranscriptRows?: TranscriptRow[];
  fathomData?: FathomMeeting;
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

export interface Args {
  limit: number;
  sinceDays: number | null;
  shadowOnly: boolean;
  fathomOnly: boolean;
  ganttsyWorkspaceOnly: boolean;
  dryRun: boolean;
  reportOnly: boolean;
  calendarFallback: boolean;
  calendarIds: string[];
  calendarWindowMinutes: number;
  tasksEnabled: boolean;
  tasksMinConfidence: number;
  tasksMaxItems: number;
}
