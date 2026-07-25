import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { closeSessionDb, getInboundDb, initTestSessionDb } from './db/connection.js';
import { isTopLevelNotifyTurn } from './top-level-notify.js';

beforeEach(() => {
  initTestSessionDb();
});

afterEach(() => {
  closeSessionDb();
});

describe('isTopLevelNotifyTurn', () => {
  it('is false when the inbox is empty (sqlite null ≠ match)', () => {
    expect(isTopLevelNotifyTurn()).toBe(false);
  });

  it('is false for chat messages even when thread_id is null', () => {
    getInboundDb()
      .prepare(
        `INSERT INTO messages_in (id, kind, timestamp, status, platform_id, channel_type, thread_id, content)
         VALUES ('c1', 'chat', datetime('now'), 'processing', 'chan', 'slack', NULL, '{}')`,
      )
      .run();
    expect(isTopLevelNotifyTurn()).toBe(false);
  });

  it('is true for a processing task with null thread_id', () => {
    getInboundDb()
      .prepare(
        `INSERT INTO messages_in (id, kind, timestamp, status, platform_id, channel_type, thread_id, content)
         VALUES ('t1', 'task', datetime('now'), 'processing', 'chan', 'slack', NULL, '{}')`,
      )
      .run();
    expect(isTopLevelNotifyTurn()).toBe(true);
  });
});
