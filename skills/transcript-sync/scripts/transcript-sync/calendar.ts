/**
 * Calendar integration — batch event fetching and attendee extraction.
 *
 * Stage 1 of the pipeline: fetches ALL calendar events for the sync window
 * in one batch per calendar ID (not per-transcript). This is both more
 * efficient and more reliable than the old per-transcript approach.
 *
 * Calendar auth failures are FATAL — the pipeline must not silently
 * misroute transcripts when the calendar is down.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { google } from 'googleapis';
import {
  GOOGLE_TOKEN,
  GOOGLE_OAUTH_CLIENT,
  SELF_EMAILS,
  IPC_DIR,
  SYSOPS_CHANNEL,
} from './config.js';
import { logInfo, logError } from './logger.js';
import type { Attendee, CalendarEvent, CalendarMeta } from './types.js';

// ============================================================================
// Service init
// ============================================================================

export function getCalendarService() {
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

// ============================================================================
// Loud failure — posts to sysops channel before throwing
// ============================================================================

export function postCalendarFailureToSysops(message: string): void {
  const messagesDir = join(IPC_DIR, 'messages');
  try {
    mkdirSync(messagesDir, { recursive: true });
    const payload = {
      type: 'message',
      chatJid: SYSOPS_CHANNEL,
      text: `:rotating_light: *transcript-sync CALENDAR FAILURE*\n${message}\n\nPipeline halted. No transcripts were routed. Fix credentials and re-run.`,
      timestamp: new Date().toISOString(),
    };
    const filename = `${Date.now()}-calendar-failure.json`;
    const filepath = join(messagesDir, filename);
    const tmpPath = `${filepath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    renameSync(tmpPath, filepath);
  } catch {
    // IPC failure shouldn't mask the original error
  }
}

export async function assertCalendarAuthHealthy(service: any, calendarIds: string[]): Promise<void> {
  if (!service) {
    const msg = 'GCAL_AUTH_FAILURE: google-token.json missing or unreadable';
    postCalendarFailureToSysops(msg);
    throw new Error(msg);
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

  const msg = `GCAL_AUTH_FAILURE: all calendar probes failed (${lastErr})`;
  postCalendarFailureToSysops(msg);
  throw new Error(msg);
}

// ============================================================================
// Batch event fetching (Stage 1)
// ============================================================================

export function extractEmailsFromDescription(desc: string): string[] {
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

function parseEventAttendees(ev: any): Attendee[] {
  const out: Attendee[] = [];
  const selfSet = new Set(SELF_EMAILS);

  for (const a of ev.attendees || []) {
    const email = (a.email || '').trim().toLowerCase();
    out.push({
      name: (a.displayName || '').trim(),
      email,
      isSelf: a.self || selfSet.has(email) ? 1 : 0,
      source: 'gcal',
    });
  }

  for (const em of extractEmailsFromDescription(ev.description || '')) {
    if (out.some(a => a.email === em)) continue; // dedup
    out.push({
      name: '',
      email: em,
      isSelf: selfSet.has(em) ? 1 : 0,
      source: 'gcal_description',
    });
  }

  return out;
}

/**
 * Fetch ALL calendar events across all calendar IDs for the given time range.
 * One API call per calendar ID — much cheaper than per-transcript.
 * Returns events sorted by start time.
 */
export async function fetchCalendarEvents(
  service: any,
  calendarIds: string[],
  timeMin: Date,
  timeMax: Date,
): Promise<CalendarEvent[]> {
  if (!service) return [];

  const events: CalendarEvent[] = [];

  for (const calId of calendarIds) {
    try {
      let pageToken: string | undefined;
      do {
        const response: any = await service.events.list({
          calendarId: calId,
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
          maxResults: 250,
          pageToken,
        });

        for (const ev of response.data.items || []) {
          const start = new Date(ev.start?.dateTime || ev.start?.date || 0);
          const end = new Date(ev.end?.dateTime || ev.end?.date || 0);
          if (isNaN(start.getTime())) continue;

          events.push({
            calendarId: calId,
            eventId: ev.id || '',
            title: ev.summary || '',
            start,
            end,
            attendees: parseEventAttendees(ev),
            description: (ev.description || '').trim(),
            attendeeNames: (ev.attendees || [])
              .map((a: any) => (a.displayName || a.email || '').trim())
              .filter(Boolean),
          });
        }

        pageToken = response.data.nextPageToken;
      } while (pageToken);
    } catch (err: any) {
      logError(`[calendar] Failed to fetch events for ${calId}: ${err.message}`);
      // Individual calendar failure is logged but not fatal — other calendars
      // may still work. The auth check already verified connectivity.
    }
  }

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  logInfo(`[calendar] Fetched ${events.length} event(s) across ${calendarIds.length} calendar(s)`);
  return events;
}

// ============================================================================
// Helpers for building CalendarMeta from a CalendarEvent (backwards compat)
// ============================================================================

export function calendarEventToMeta(ev: CalendarEvent): CalendarMeta {
  return {
    calendar_id: ev.calendarId,
    event_id: ev.eventId,
    event_title: ev.title,
    event_start: ev.start.toISOString(),
    event_description: ev.description,
    attendee_names: ev.attendeeNames,
  };
}
