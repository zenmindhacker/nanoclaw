import { existsSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { SHADOW_DB_PATH, TRANS_STATUS_COMPLETE } from './config.mjs';

export function openDb() {
  if (!existsSync(SHADOW_DB_PATH)) {
    throw new Error(`Shadow database not found: ${SHADOW_DB_PATH}`);
  }
  return new DatabaseSync(SHADOW_DB_PATH, { readOnly: true });
}

export function buildSearchQuery(filters) {
  const conditions = ['c.transStatus = ?'];
  const params = [TRANS_STATUS_COMPLETE];

  if (filters.convIdx !== undefined) {
    conditions.push('c.convIdx = ?');
    params.push(filters.convIdx);
  }

  if (filters.sinceDays !== undefined) {
    conditions.push(
      "datetime(replace(substr(c.convStartedAt,1,19),'T',' ')) >= datetime('now', ?)",
    );
    params.push(`-${filters.sinceDays} days`);
  }

  if (filters.from) {
    conditions.push("datetime(replace(substr(c.convStartedAt,1,19),'T',' ')) >= datetime(?)");
    params.push(filters.from);
  }

  if (filters.to) {
    conditions.push("datetime(replace(substr(c.convStartedAt,1,19),'T',' ')) <= datetime(?)");
    params.push(filters.to);
  }

  if (filters.title) {
    conditions.push('c.convTitle LIKE ?');
    params.push(`%${filters.title}%`);
  }

  if (filters.presetSql) {
    conditions.push(`(${filters.presetSql})`);
    if (filters.presetParams?.length) params.push(...filters.presetParams);
  }

  if (filters.attendeeEmail) {
    const e = filters.attendeeEmail.toLowerCase();
    conditions.push(`(
      EXISTS (SELECT 1 FROM SHADOW_ATTENDEE a WHERE a.convUuid = c.convUuid AND lower(a.email) = ?)
      OR EXISTS (SELECT 1 FROM SHADOW_CAL_EVENT e WHERE e.eventId = c.eventId AND (
        lower(e.eventDescription) LIKE ? OR lower(e.eventAttendees) LIKE ?
      ))
    )`);
    params.push(e, `%${e}%`, `%${e}%`);
  }

  if (filters.attendeeDomain) {
    const d = filters.attendeeDomain.replace(/^@/, '');
    const at = `%@${d}%`;
    conditions.push(`(
      EXISTS (SELECT 1 FROM SHADOW_ATTENDEE a WHERE a.convUuid = c.convUuid AND a.email LIKE ?)
      OR EXISTS (SELECT 1 FROM SHADOW_CAL_EVENT e WHERE e.eventId = c.eventId AND (
        e.eventDescription LIKE ? OR e.eventAttendees LIKE ?
      ))
    )`);
    params.push(at, at, `%${d}%`);
  }

  if (filters.attendeeName) {
    const p = `%${filters.attendeeName}%`;
    conditions.push(`(
      EXISTS (SELECT 1 FROM SHADOW_ATTENDEE a WHERE a.convUuid = c.convUuid AND a.displayName LIKE ?)
      OR EXISTS (SELECT 1 FROM SHADOW_CAL_EVENT e WHERE e.eventId = c.eventId AND e.eventAttendees LIKE ?)
    )`);
    params.push(p, p);
  }

  if (filters.calendarId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM SHADOW_CAL_EVENT e WHERE e.eventId = c.eventId AND e.calendarId = ?
    )`);
    params.push(filters.calendarId);
  }

  const grepTerm = filters.grep || filters.presetGrep;
  if (grepTerm) {
    conditions.push(`EXISTS (
      SELECT 1 FROM SHADOW_TRANSCRIPT t WHERE t.convIdx = c.convIdx AND t.transContent LIKE ?
    )`);
    params.push(`%${grepTerm}%`);
  }

  if (filters.grepSpeaker) {
    conditions.push(`EXISTS (
      SELECT 1 FROM SHADOW_TRANSCRIPT t
      JOIN SHADOW_SPEAKER s ON s.spkrIdx = t.spkrIdx
      WHERE t.convIdx = c.convIdx AND s.spkrName LIKE ?
    )`);
    params.push(`%${filters.grepSpeaker}%`);
  }

  if (filters.any) {
    const p = `%${filters.any}%`;
    conditions.push(`(
      c.convTitle LIKE ?
      OR EXISTS (SELECT 1 FROM SHADOW_ATTENDEE a WHERE a.convUuid = c.convUuid AND (
        a.email LIKE ? OR a.displayName LIKE ?
      ))
      OR EXISTS (SELECT 1 FROM SHADOW_CAL_EVENT e WHERE e.eventId = c.eventId AND (
        e.eventTitle LIKE ? OR e.eventDescription LIKE ? OR e.eventAttendees LIKE ?
      ))
      OR EXISTS (SELECT 1 FROM SHADOW_TRANSCRIPT t WHERE t.convIdx = c.convIdx AND t.transContent LIKE ?)
    )`);
    params.push(p, p, p, p, p, p, p);
  }

  const limit = filters.limit ?? 50;
  const sql = `
    SELECT
      c.convIdx,
      c.convUuid,
      c.convTitle,
      c.convStartedAt,
      c.convEndedAt,
      c.eventId,
      e.eventTitle,
      e.calendarId,
      (
        SELECT GROUP_CONCAT(
          CASE WHEN a.email != '' THEN a.email ELSE a.displayName END, ', '
        )
        FROM SHADOW_ATTENDEE a
        WHERE a.convUuid = c.convUuid AND a.isSelf = 0
        LIMIT 8
      ) AS attendeeSummary,
      (SELECT COUNT(*) FROM SHADOW_TRANSCRIPT t WHERE t.convIdx = c.convIdx) AS segmentCount
    FROM SHADOW_CONVERSATION c
    LEFT JOIN SHADOW_CAL_EVENT e ON e.eventId = c.eventId
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.convIdx DESC
    LIMIT ?
  `;
  params.push(limit);

  return { sql, params };
}

export function searchConversations(db, filters) {
  const { sql, params } = buildSearchQuery(filters);
  return db.prepare(sql).all(...params);
}

export function fetchTranscript(db, convIdx) {
  return db
    .prepare(
      `SELECT t.transStartedAt, t.transEndedAt, t.transContent, COALESCE(s.spkrName,'') as spkrName
       FROM SHADOW_TRANSCRIPT t
       LEFT JOIN SHADOW_SPEAKER s ON s.spkrIdx = t.spkrIdx
       WHERE t.convIdx = ?
       ORDER BY t.transIdx ASC`,
    )
    .all(convIdx);
}

export function fetchConversation(db, convIdx) {
  return searchConversations(db, { convIdx, limit: 1 })[0];
}

export function fetchCalEvent(db, eventId) {
  return db
    .prepare(
      `SELECT eventTitle, calendarId, eventStartedAt, eventEndedAt,
              eventDescription, eventAttendees, eventOrganizer
       FROM SHADOW_CAL_EVENT WHERE eventId = ?`,
    )
    .get(eventId);
}

export function fetchAttendees(db, convUuid) {
  return db
    .prepare(
      `SELECT COALESCE(displayName,'') as displayName, COALESCE(email,'') as email,
              COALESCE(isSelf,0) as isSelf
       FROM SHADOW_ATTENDEE WHERE convUuid = ?`,
    )
    .all(convUuid);
}

export function formatTranscript(lines) {
  return lines
    .map((l) => {
      const speaker = l.spkrName?.trim() || 'Speaker';
      return `${speaker}: ${l.transContent}`;
    })
    .join('\n');
}

export function slugify(title) {
  return (title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export function buildMarkdownDocument(conv, attendees, cal, lines) {
  const date = conv.convStartedAt?.slice(0, 10) ?? 'unknown-date';
  const title = (conv.convTitle || 'Untitled').trim();
  const parts = [
    `# ${title}`,
    '',
    `- convIdx: ${conv.convIdx}`,
    `- date: ${date}`,
    `- started: ${conv.convStartedAt ?? ''}`,
    `- segments: ${lines.length}`,
  ];
  if (cal?.eventTitle) parts.push(`- cal_event: ${cal.eventTitle}`);
  if (cal?.calendarId) parts.push(`- calendar: ${cal.calendarId}`);
  if (attendees.length) {
    const list = attendees
      .map((a) => `${a.displayName || a.email}${a.isSelf ? ' (self)' : ''}`.trim())
      .filter(Boolean)
      .join(', ');
    parts.push(`- attendees: ${list}`);
  }
  if (cal?.eventDescription) {
    const desc = String(cal.eventDescription).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (desc) parts.push(`- cal_description: ${desc}`);
  }
  parts.push('', '## Transcript', '', formatTranscript(lines));
  return parts.join('\n');
}

/** Return grep hits with surrounding context from transcript segments */
export function fetchGrepExcerpts(db, convIdx, term, { contextChars = 120, limit = 20 } = {}) {
  const pattern = `%${term}%`;
  const rows = db
    .prepare(
      `SELECT t.transContent, COALESCE(s.spkrName,'') as spkrName
       FROM SHADOW_TRANSCRIPT t
       LEFT JOIN SHADOW_SPEAKER s ON s.spkrIdx = t.spkrIdx
       WHERE t.convIdx = ? AND t.transContent LIKE ?
       ORDER BY t.transIdx ASC
       LIMIT ?`,
    )
    .all(convIdx, pattern, limit);

  return rows.map((r) => {
    const content = r.transContent || '';
    const lower = content.toLowerCase();
    const needle = term.toLowerCase();
    const idx = lower.indexOf(needle);
    const start = Math.max(0, idx - contextChars);
    const end = Math.min(content.length, idx + term.length + contextChars);
    const excerpt =
      (start > 0 ? '…' : '') +
      content.slice(start, end) +
      (end < content.length ? '…' : '');
    return {
      speaker: r.spkrName?.trim() || 'Speaker',
      excerpt,
      match: term,
    };
  });
}

export function loadFullConversation(db, convIdx) {
  const conv = fetchConversation(db, convIdx);
  if (!conv) return null;
  const attendees = fetchAttendees(db, conv.convUuid);
  const lines = fetchTranscript(db, convIdx);
  const cal = conv.eventId ? fetchCalEvent(db, conv.eventId) : undefined;
  return { conv, attendees, lines, cal };
}
