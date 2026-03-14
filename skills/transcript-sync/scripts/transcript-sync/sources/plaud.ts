/**
 * Plaud source — fetches transcripts from the Plaud direct API.
 */

import { existsSync, readFileSync } from 'fs';
import { PLAUD_JWT_PATH, PLAUD_API_BASE } from '../config.js';
import { logError, logWarn } from '../logger.js';
import type { PlaudFile, PlaudTranscriptSegment } from '../types.js';

export function getPlaudToken(): string | null {
  if (!existsSync(PLAUD_JWT_PATH)) {
    return null;
  }
  try {
    return readFileSync(PLAUD_JWT_PATH, 'utf-8').trim();
  } catch {
    return null;
  }
}

export async function fetchPlaudFiles(token: string, startAfter: number | null, limit: number = 50): Promise<PlaudFile[]> {
  try {
    const url = `${PLAUD_API_BASE}/file/simple/web?skip=0&limit=${limit}&is_trash=2&sort_by=start_time&is_desc=true`;
    const response = await fetch(url, {
      headers: { 'Authorization': token },
    });

    if (!response.ok) {
      throw new Error(`Plaud API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const files: PlaudFile[] = (data.data_file_list || []).map((f: any) => ({
      id: f.id,
      filename: f.filename || '',
      duration: f.duration || 0,
      start_time: f.start_time || 0,
    }));

    if (startAfter !== null) {
      return files.filter(f => f.start_time > startAfter);
    }
    return files;
  } catch (err: any) {
    logError(`[plaud] Failed to fetch files: ${err.message}`);
    return [];
  }
}

export async function fetchPlaudTranscriptSegments(token: string, fileId: string): Promise<PlaudTranscriptSegment[] | null> {
  try {
    // Step 1: Get file detail with content links
    const detailUrl = `${PLAUD_API_BASE}/file/detail/${fileId}`;
    const detailResponse = await fetch(detailUrl, {
      headers: { 'Authorization': token },
    });

    if (!detailResponse.ok) {
      throw new Error(`Plaud detail API error ${detailResponse.status}: ${await detailResponse.text()}`);
    }

    const detail = await detailResponse.json();
    const contentList = detail.data?.content_list || [];

    // Step 2: Find the transaction (transcript) entry
    const transcriptEntry = contentList.find((c: any) => c.data_type === 'transaction');
    if (!transcriptEntry?.data_link) {
      logWarn(`[plaud] No transcript found for file ${fileId}`);
      return null;
    }

    // Step 3: Fetch the transcript data from the signed S3 URL
    const transcriptResponse = await fetch(transcriptEntry.data_link);
    if (!transcriptResponse.ok) {
      throw new Error(`Failed to fetch transcript data: ${transcriptResponse.status}`);
    }

    const transcriptData = await transcriptResponse.json();

    // Parse segments — the response uses numeric keys ("0", "1", "2", ...)
    const segments: PlaudTranscriptSegment[] = [];
    for (let i = 0; transcriptData[String(i)] !== undefined; i++) {
      const seg = transcriptData[String(i)];
      segments.push({
        content: seg.content || '',
        start_time: seg.start_time || 0,
        end_time: seg.end_time || 0,
        speaker: seg.speaker || '',
        original_speaker: seg.original_speaker || '',
      });
    }

    return segments.length > 0 ? segments : null;
  } catch (err: any) {
    logError(`[plaud] Failed to fetch transcript for ${fileId}: ${err.message}`);
    return null;
  }
}

export function formatPlaudTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
