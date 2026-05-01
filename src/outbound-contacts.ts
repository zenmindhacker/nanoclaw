/**
 * Global outbound contacts.
 *
 * These are JIDs any group context (main, side groups, thread groups) is
 * allowed to send messages to via IPC. The canonical use case is the
 * operator's personal DM: the agent should be able to DM its owner from
 * wherever it's running, not only from the main group.
 *
 * Contacts are loaded from `{DATA_DIR}/outbound_contacts.json`. The file
 * is optional — if missing, the global allowlist is empty and behavior
 * is identical to pre-feature NanoClaw.
 *
 * File format:
 *   {
 *     "contacts": [
 *       { "jid": "slack:D0APR54QDKP", "name": "Christina", "description": "Operator DM" }
 *     ]
 *   }
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export interface OutboundContact {
  jid: string;
  name: string;
  description?: string;
}

interface ContactsFile {
  contacts?: OutboundContact[];
}

const CONTACTS_FILE = path.join(DATA_DIR, 'outbound_contacts.json');

let cached: OutboundContact[] = [];
let cachedJids: Set<string> = new Set();

/**
 * Load (or reload) the outbound contacts file. Safe to call repeatedly —
 * failure to parse falls back to the previously cached value.
 */
export function loadOutboundContacts(): OutboundContact[] {
  try {
    if (!fs.existsSync(CONTACTS_FILE)) {
      cached = [];
      cachedJids = new Set();
      return cached;
    }
    const raw = fs.readFileSync(CONTACTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ContactsFile;
    if (!parsed || !Array.isArray(parsed.contacts)) {
      logger.warn(
        { file: CONTACTS_FILE },
        'outbound_contacts.json missing "contacts" array — ignoring',
      );
      cached = [];
      cachedJids = new Set();
      return cached;
    }
    const valid = parsed.contacts.filter(
      (c): c is OutboundContact =>
        typeof c?.jid === 'string' &&
        c.jid.length > 0 &&
        typeof c?.name === 'string',
    );
    cached = valid;
    cachedJids = new Set(valid.map((c) => c.jid));
    logger.info({ count: valid.length }, 'Loaded global outbound contacts');
    return cached;
  } catch (err) {
    logger.warn(
      { err, file: CONTACTS_FILE },
      'Failed to load outbound_contacts.json — keeping previous contacts',
    );
    return cached;
  }
}

/** Current cached contacts list. */
export function getOutboundContacts(): OutboundContact[] {
  return cached;
}

/** Fast membership check used by the IPC authorization gate. */
export function isGlobalOutboundJid(jid: string): boolean {
  return cachedJids.has(jid);
}
