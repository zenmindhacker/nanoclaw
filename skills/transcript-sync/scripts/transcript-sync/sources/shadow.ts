/**
 * Shadow source — reads transcripts from the local Shadow SQLite database.
 */

import Database from 'better-sqlite3';
import type { Attendee, TranscriptRow } from '../types.js';

export function parseShadowDt(isoNoTz: string): Date {
  // Shadow stores timestamps without timezone - interpret as local
  return new Date(isoNoTz);
}

export function fetchAttendees(db: Database.Database, convUuid: string): Attendee[] {
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

export function fetchTranscriptRows(db: Database.Database, convIdx: number): TranscriptRow[] {
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
