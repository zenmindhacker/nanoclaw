/**
 * Gmail API Helpers
 * Search, read, and manage emails via Gmail REST API.
 * Uses host-managed OAuth (read-only) via skills/google-workspace lib.
 */

import https from 'https';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

import { getAccessToken } from '../../google-workspace/lib/access-token.mjs';

function resolveCredPath(filename) {
  const servicesPath = `/workspace/extra/credentials/services/${filename}`;
  if (existsSync(servicesPath)) return servicesPath;
  const containerPath = `/workspace/extra/credentials/${filename}`;
  if (existsSync(containerPath)) return containerPath;
  return resolve(homedir(), `.config/nanoclaw/credentials/services/${filename}`);
}

const REGISTRY_ID =
  process.env.GOOGLE_REGISTRY_ID ??
  (existsSync(resolveCredPath('google-gmail-token.json')) ? 'google-gmail-legacy' : 'shadow-google');

/**
 * Load access token from host-managed OAuth (no in-container refresh/write).
 */
async function getGmailAccessToken() {
  return getAccessToken(REGISTRY_ID);
}

/**
 * Make authenticated Gmail API request (JSON responses)
 */
async function gmailRequest(path, method = 'GET', body = null) {
  const accessToken = await getGmailAccessToken();
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/' + path);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Search for emails matching a query
 */
export async function searchMessages(query, maxResults = 10) {
  const q = encodeURIComponent(query);
  return gmailRequest(`messages?q=${q}&maxResults=${maxResults}`);
}

/**
 * Get full message details
 */
export async function getMessage(messageId, format = 'full') {
  return gmailRequest(`messages/${messageId}?format=${format}`);
}

/**
 * Get attachment data (returns base64url-encoded)
 */
export async function getAttachment(messageId, attachmentId) {
  return gmailRequest(`messages/${messageId}/attachments/${attachmentId}`);
}

/**
 * Download attachment and return as Buffer
 */
export async function downloadAttachment(messageId, attachmentId) {
  const data = await getAttachment(messageId, attachmentId);
  if (data.data) {
    return Buffer.from(data.data, 'base64url');
  }
  throw new Error('No attachment data returned');
}

/**
 * Extract headers, body text, and attachment info from a message
 */
export function parseMessage(message) {
  const headers = message.payload?.headers || [];
  const result = {
    id: message.id,
    threadId: message.threadId,
    subject: headers.find(h => h.name === 'Subject')?.value || '',
    from: headers.find(h => h.name === 'From')?.value || '',
    date: headers.find(h => h.name === 'Date')?.value || '',
    to: headers.find(h => h.name === 'To')?.value || '',
    body: '',
    attachments: [],
    labels: message.labelIds || []
  };

  scanParts(message.payload, result);
  return result;
}

function scanParts(part, result) {
  if (!part) return;

  if (part.filename && part.filename.length > 0) {
    result.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType,
      size: part.body?.size || 0,
      attachmentId: part.body?.attachmentId
    });
  }

  if (part.mimeType === 'text/plain' && part.body?.data && !part.filename) {
    result.body += Buffer.from(part.body.data, 'base64url').toString();
  }

  for (const child of part.parts || []) {
    scanParts(child, result);
  }
}

/**
 * Add label(s) to a message
 */
export async function addLabel(messageId, labelIds) {
  const ids = Array.isArray(labelIds) ? labelIds : [labelIds];
  return gmailRequest(`messages/${messageId}/modify`, 'POST', {
    addLabelIds: ids
  });
}


/**
 * Remove label(s) from a message
 */
export async function removeLabel(messageId, labelIds) {
  const ids = Array.isArray(labelIds) ? labelIds : [labelIds];
  return gmailRequest(`messages/${messageId}/modify`, 'POST', {
    removeLabelIds: ids
  });
}

/**
 * Get or create a Gmail label by name. Returns the label ID.
 */
export async function getOrCreateLabel(labelName) {
  const labelsResponse = await gmailRequest('labels');
  const labels = labelsResponse.labels || [];
  const existing = labels.find(l => l.name === labelName);
  if (existing) return existing.id;

  const created = await gmailRequest('labels', 'POST', {
    name: labelName,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show'
  });
  return created.id;
}

/**
 * Parse a month name or abbreviation from text into { month, year }
 * e.g. "February" → { month: 2 }, "Jan 2026" → { month: 1, year: 2026 }
 */
export function parseMonthFromText(text) {
  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  const lower = text.toLowerCase();

  // Try "Month YYYY" or "YYYY-MM" patterns
  for (const [name, num] of Object.entries(MONTHS)) {
    if (lower.includes(name)) {
      const yearMatch = text.match(/\b(20\d{2})\b/);
      return { month: num, year: yearMatch ? parseInt(yearMatch[1]) : null };
    }
  }

  // Try YYYY-MM format
  const isoMatch = text.match(/\b(20\d{2})-(0[1-9]|1[0-2])\b/);
  if (isoMatch) {
    return { month: parseInt(isoMatch[2]), year: parseInt(isoMatch[1]) };
  }

  return null;
}
