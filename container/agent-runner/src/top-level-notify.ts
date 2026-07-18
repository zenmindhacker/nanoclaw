/**
 * Detect proactive task wakes that should post as top-level channel/DM
 * pings (null thread_id) instead of inheriting the session's Slack thread.
 */
import { getInboundDb } from './db/connection.js';

export function isTopLevelNotifyTurn(): boolean {
  try {
    const row = getInboundDb()
      .prepare(
        `SELECT 1 AS ok FROM messages_in
         WHERE kind = 'task'
           AND status = 'processing'
           AND (thread_id IS NULL OR thread_id = '')
         LIMIT 1`,
      )
      .get() as { ok: number } | undefined;
    return row !== undefined;
  } catch {
    return false;
  }
}
