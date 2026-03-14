/**
 * Ganttsy Workspace source — fetches meeting transcripts from Google Drive/Docs.
 */

import { existsSync, readFileSync } from 'fs';
import { google } from 'googleapis';
import {
  GANTTSY_GOOGLE_TOKEN,
  GANTTSY_GOOGLE_OAUTH_CLIENT,
  GANTTSY_WORKSPACE_FOLDER,
} from '../config.js';
import { logInfo, logError, logWarn } from '../logger.js';
import type { GanttsyWorkspaceDoc } from '../types.js';

export function getGanttsyDriveService() {
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

export async function fetchGanttsyWorkspaceDocs(
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

export async function fetchGanttsyWorkspaceTranscript(docId: string): Promise<string | null> {
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

export function parseGanttsyWorkspaceMeetingDate(docName: string, modifiedTime: string): Date {
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

export function parseGanttsyWorkspaceAttendees(content: string): string[] {
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
