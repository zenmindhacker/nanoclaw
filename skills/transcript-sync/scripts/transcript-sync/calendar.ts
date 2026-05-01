/**
 * Calendar integration — Google Calendar service and attendee fallback matching.
 */

import { existsSync, readFileSync } from 'fs';
import { google } from 'googleapis';
import { GOOGLE_TOKEN, GOOGLE_OAUTH_CLIENT } from './config.js';
import type { Attendee, CalendarMeta } from './types.js';

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

export async function assertCalendarAuthHealthy(service: any, calendarIds: string[]): Promise<void> {
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

export async function calendarFallbackAttendees(
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

        // Prefer events with attendee data (Consulting calendar syncs embed attendees in description)
        const hasAttendeeData = (ev.attendees && ev.attendees.length > 1) ||
          (ev.description && /Attendees:/i.test(ev.description));
        const attendeeBonus = hasAttendeeData ? 0.3 : 0;

        // Combined score: time proximity primary, attendee data secondary, title tertiary
        const score = timeScore + attendeeBonus + (titleScore * 0.1);

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

  // Reject weak matches: if the best candidate event has no attendees AND
  // no `Attendees:` block in the description, we have no reliable way to
  // classify the meeting. Better to return "no match" than to anchor the
  // file to a random same-time placeholder event — the pipeline will route
  // this meeting to the unmatched list so the user can triage it.
  const hasAttendeeData =
    (ev.attendees && ev.attendees.length > 0) ||
    (ev.description && /Attendees:/i.test(ev.description));
  if (!hasAttendeeData) {
    return [[], null];
  }

  // Reject title-mismatch matches: when both titles are non-trivial and
  // share ZERO tokens (3+ chars, ignoring stopwords), the time-only match
  // is probably wrong. This happens when two unrelated meetings overlap —
  // e.g. a Ganttsy product call recorded by Shadow happens to overlap with
  // a CopperTeams sync that has full attendee data. Time proximity wins
  // the match against an event whose content is unrelated to the recording.
  const STOP = new Set([
    'the','and','for','with','from','this','that','have','your','our',
    'you','are','was','will','can','call','meet','meeting','sync',
    'weekly','daily','monthly','catch','upcoming','scheduled',
    'cian','rustam','greg','bart','aby','vergel','team','update'
  ]);
  const tok = (s: string): Set<string> => {
    const out = new Set<string>();
    for (const t of (s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
      if (!STOP.has(t)) out.add(t);
    }
    return out;
  };
  const convTokens = tok(convTitle);
  const evTokens = tok(ev.summary || '');
  // Threshold: conv title has 3+ meaningful tokens (i.e. it's descriptive,
  // not just "Sync") and the event title has at least 1. If overlap is zero,
  // the time-only match is too risky to trust.
  if (convTokens.size >= 3 && evTokens.size >= 1) {
    let overlap = 0;
    for (const t of convTokens) if (evTokens.has(t)) overlap++;
    if (overlap === 0) {
      return [[], null];
    }
  }

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
    const selfEmails = ['cian@cognitivetech.net', 'cian@ganttsy.com', 'cian@copperteams.ai', 'cian.whalley@newvaluegroup.com'];
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
