import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeSlackThreadId } from '../../channels/slack-stream.js';
import type { MessagingGroup } from '../../types.js';

const TEST_DIR = '/tmp/nanoclaw-history-sync-test';
const GROUPS_DIR_TEST = path.join(TEST_DIR, 'groups');

vi.mock('../../env.js', () => ({
  readEnvFile: vi.fn(() => ({ SLACK_BOT_TOKEN: 'xoxb-test-token' })),
}));

vi.mock('../../log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../config.js', async () => {
  const actual = await vi.importActual<typeof import('../../config.js')>('../../config.js');
  return {
    ...actual,
    DATA_DIR: '/tmp/nanoclaw-history-sync-test',
    GROUPS_DIR: '/tmp/nanoclaw-history-sync-test/groups',
    ASSISTANT_NAME: 'Cleo',
  };
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const THREAD_ID = 'slack:C07F195GB96:1781715627.799729';
const CHANNEL_ID = 'C07F195GB96';
const THREAD_TS = '1781715627.799729';

describe('Slack history sync helpers', () => {
  it('decodeSlackThreadId parses channel thread ids', () => {
    const decoded = decodeSlackThreadId(THREAD_ID);
    expect(decoded).toEqual({ channel: CHANNEL_ID, threadTs: THREAD_TS });
  });

  it('decodeSlackThreadId parses bare channel ids', () => {
    const decoded = decodeSlackThreadId('slack:D0AFGMS9UE6');
    expect(decoded).toEqual({ channel: 'D0AFGMS9UE6', threadTs: '' });
  });

  it('history message ids are stable per Slack ts', () => {
    expect(`slack-sync:${THREAD_TS}`).toBe('slack-sync:1781715627.799729');
  });
});

describe('Slack history sync integration', () => {
  let closeDb: () => void;
  let createAgentGroup: typeof import('../../db/index.js').createAgentGroup;
  let createMessagingGroup: typeof import('../../db/index.js').createMessagingGroup;
  let createMessagingGroupAgent: typeof import('../../db/index.js').createMessagingGroupAgent;
  let createSession: typeof import('../../db/index.js').createSession;
  let initTestDb: typeof import('../../db/index.js').initTestDb;
  let runMigrations: typeof import('../../db/index.js').runMigrations;
  let getSession: typeof import('../../db/sessions.js').getSession;
  let initSessionFolder: typeof import('../../session-manager.js').initSessionFolder;
  let inboundDbPath: typeof import('../../session-manager.js').inboundDbPath;
  let writeSessionMessage: typeof import('../../session-manager.js').writeSessionMessage;
  let exportSessionHistoryFiles: typeof import('./history-sync.js').exportSessionHistoryFiles;
  let stopSlackHistoryPeriodicSync: typeof import('./history-sync.js').stopSlackHistoryPeriodicSync;
  let syncMentionStickyThreadAfterOutbound: typeof import('./history-sync.js').syncMentionStickyThreadAfterOutbound;
  let syncSessionFromSlack: typeof import('./history-sync.js').syncSessionFromSlack;

  function now() {
    return new Date().toISOString();
  }

  function jsonResponse(body: unknown): Response {
    return {
      ok: true,
      json: async () => body,
    } as Response;
  }

  function readInboundRows(agentGroupId: string, sessionId: string): Array<{ id: string; trigger: number }> {
    const db = new Database(inboundDbPath(agentGroupId, sessionId), { readonly: true });
    try {
      return db.prepare('SELECT id, trigger FROM messages_in ORDER BY timestamp ASC').all() as Array<{
        id: string;
        trigger: number;
      }>;
    } finally {
      db.close();
    }
  }

  function installSlackFetchMock(replies: Array<Record<string, unknown>> = []) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = url.replace('https://slack.com/api/', '');
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['Content-Type']).toBe('application/x-www-form-urlencoded; charset=utf-8');
      expect(headers?.Authorization).toBe('Bearer xoxb-test-token');

      const params = new URLSearchParams(String(init?.body ?? ''));
      if (method === 'auth.test') {
        return jsonResponse({ ok: true, user_id: 'U_BOT' });
      }
      if (method === 'conversations.replies') {
        expect(params.get('channel')).toBe(CHANNEL_ID);
        expect(params.get('ts')).toBe(THREAD_TS);
        return jsonResponse({ ok: true, messages: replies });
      }
      if (method === 'conversations.history') {
        return jsonResponse({ ok: true, messages: [] });
      }
      throw new Error(`Unexpected Slack API method: ${method}`);
    });
  }

  function seedSysopsThreadSession(sessionId = 'sess-sysops') {
    createAgentGroup({
      id: 'ag-cleo',
      name: 'Cleo',
      folder: 'slack-sysops',
      agent_provider: null,
      created_at: now(),
    });
    createMessagingGroup({
      id: 'mg-sysops',
      channel_type: 'slack',
      platform_id: 'slack:C07F195GB96',
      name: '#sysops',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });
    createMessagingGroupAgent({
      id: 'mga-cleo',
      messaging_group_id: 'mg-sysops',
      agent_group_id: 'ag-cleo',
      engage_mode: 'mention-sticky',
      engage_pattern: null,
      sender_scope: 'all',
      ignored_message_policy: 'drop',
      session_mode: 'per-thread',
      priority: 0,
      created_at: now(),
    });
    createSession({
      id: sessionId,
      agent_group_id: 'ag-cleo',
      messaging_group_id: 'mg-sysops',
      thread_id: THREAD_ID,
      agent_provider: null,
      status: 'active',
      container_status: 'idle',
      last_active: now(),
      created_at: now(),
    });
    initSessionFolder('ag-cleo', sessionId);
    fs.mkdirSync(path.join(GROUPS_DIR_TEST, 'slack-sysops'), { recursive: true });
    return getSession(sessionId)!;
  }

  beforeEach(async () => {
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(GROUPS_DIR_TEST, { recursive: true });
    fetchMock.mockReset();

    const dbMod = await import('../../db/index.js');
    const sessionsMod = await import('../../db/sessions.js');
    const sessionMgr = await import('../../session-manager.js');
    const historyMod = await import('./history-sync.js');

    closeDb = dbMod.closeDb;
    createAgentGroup = dbMod.createAgentGroup;
    createMessagingGroup = dbMod.createMessagingGroup;
    createMessagingGroupAgent = dbMod.createMessagingGroupAgent;
    createSession = dbMod.createSession;
    initTestDb = dbMod.initTestDb;
    runMigrations = dbMod.runMigrations;
    getSession = sessionsMod.getSession;
    initSessionFolder = sessionMgr.initSessionFolder;
    inboundDbPath = sessionMgr.inboundDbPath;
    writeSessionMessage = sessionMgr.writeSessionMessage;
    exportSessionHistoryFiles = historyMod.exportSessionHistoryFiles;
    stopSlackHistoryPeriodicSync = historyMod.stopSlackHistoryPeriodicSync;
    syncMentionStickyThreadAfterOutbound = historyMod.syncMentionStickyThreadAfterOutbound;
    syncSessionFromSlack = historyMod.syncSessionFromSlack;

    const db = initTestDb();
    runMigrations(db);
  });

  afterEach(() => {
    stopSlackHistoryPeriodicSync();
    closeDb();
    if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  });

  describe('syncSessionFromSlack', () => {
    it('backfills thread messages as trigger=0 context rows via form-encoded Slack API', async () => {
      installSlackFetchMock([
        { ts: THREAD_TS, text: 'NVS Email Processor — Error', user: 'U_BOT', bot_id: 'B1' },
        { ts: '1781727827.028319', text: 'can you check it now?', user: 'U_USER' },
      ]);

      const session = seedSysopsThreadSession();
      await syncSessionFromSlack(session);

      const rows = readInboundRows('ag-cleo', session.id);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.trigger === 0)).toBe(true);
      expect(rows.map((r) => r.id)).toEqual(['slack-sync:1781715627.799729', 'slack-sync:1781727827.028319']);

      const repliesCall = fetchMock.mock.calls.find(([url]) => String(url).includes('conversations.replies'));
      expect(repliesCall).toBeDefined();
      const body = new URLSearchParams(String(repliesCall?.[1]?.body));
      expect(body.get('channel')).toBe(CHANNEL_ID);
      expect(body.get('ts')).toBe(THREAD_TS);
    });

    it('deduplicates slack-sync rows on repeated sync', async () => {
      installSlackFetchMock([{ ts: THREAD_TS, text: 'Alert body', user: 'U_BOT', bot_id: 'B1' }]);

      const session = seedSysopsThreadSession();
      await syncSessionFromSlack(session);
      await syncSessionFromSlack(session);

      const rows = readInboundRows('ag-cleo', session.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(`slack-sync:${THREAD_TS}`);
    });

    it('exports slack_history.json to the agent group folder', async () => {
      installSlackFetchMock([{ ts: THREAD_TS, text: 'invoice-generator missing', user: 'U_BOT', bot_id: 'B1' }]);

      const session = seedSysopsThreadSession();
      await syncSessionFromSlack(session);

      const exportPath = path.join(GROUPS_DIR_TEST, 'slack-sysops', 'slack_history.json');
      expect(fs.existsSync(exportPath)).toBe(true);
      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as Array<{ text: string; sender: string }>;
      expect(exported).toHaveLength(1);
      expect(exported[0].text).toContain('invoice-generator missing');
      expect(exported[0].sender).toBe('Cleo');
    });
  });

  describe('syncMentionStickyThreadAfterOutbound', () => {
    it('backfills only mention-sticky agents on outbound alert threads', async () => {
      installSlackFetchMock([{ ts: THREAD_TS, text: 'Scheduled alert', user: 'U_BOT', bot_id: 'B1' }]);

      createAgentGroup({
        id: 'ag-sticky',
        name: 'Sticky',
        folder: 'slack-sticky',
        agent_provider: null,
        created_at: now(),
      });
      createAgentGroup({
        id: 'ag-normal',
        name: 'Normal',
        folder: 'slack-normal',
        agent_provider: null,
        created_at: now(),
      });
      createMessagingGroup({
        id: 'mg-sysops',
        channel_type: 'slack',
        platform_id: 'slack:C07F195GB96',
        name: '#sysops',
        is_group: 1,
        unknown_sender_policy: 'strict',
        created_at: now(),
      });
      createMessagingGroupAgent({
        id: 'mga-sticky',
        messaging_group_id: 'mg-sysops',
        agent_group_id: 'ag-sticky',
        engage_mode: 'mention-sticky',
        engage_pattern: null,
        sender_scope: 'all',
        ignored_message_policy: 'drop',
        session_mode: 'per-thread',
        priority: 0,
        created_at: now(),
      });
      createMessagingGroupAgent({
        id: 'mga-normal',
        messaging_group_id: 'mg-sysops',
        agent_group_id: 'ag-normal',
        engage_mode: 'always',
        engage_pattern: null,
        sender_scope: 'all',
        ignored_message_policy: 'drop',
        session_mode: 'per-thread',
        priority: 1,
        created_at: now(),
      });

      fs.mkdirSync(path.join(GROUPS_DIR_TEST, 'slack-sticky'), { recursive: true });
      fs.mkdirSync(path.join(GROUPS_DIR_TEST, 'slack-normal'), { recursive: true });

      const mg = {
        id: 'mg-sysops',
        channel_type: 'slack',
        platform_id: 'slack:C07F195GB96',
        name: '#sysops',
        is_group: 1,
        unknown_sender_policy: 'strict',
        created_at: now(),
      } satisfies MessagingGroup;

      await syncMentionStickyThreadAfterOutbound(mg, 'slack:C07F195GB96', THREAD_ID);

      const { resolveSession } = await import('../../session-manager.js');
      const sticky = resolveSession('ag-sticky', 'mg-sysops', THREAD_ID, 'per-thread');
      const normal = resolveSession('ag-normal', 'mg-sysops', THREAD_ID, 'per-thread');

      const stickyRows = readInboundRows('ag-sticky', sticky.session.id);
      const normalRows = readInboundRows('ag-normal', normal.session.id);
      expect(stickyRows.some((r) => r.id === `slack-sync:${THREAD_TS}`)).toBe(true);
      expect(normalRows).toHaveLength(0);
    });
  });

  describe('exportSessionHistoryFiles', () => {
    it('writes slack_history.json from existing inbound rows', () => {
      const session = seedSysopsThreadSession('sess-export');
      writeSessionMessage('ag-cleo', session.id, {
        id: 'slack-sync:1781715627.799729',
        kind: 'chat-sdk',
        timestamp: '2026-06-17T17:00:27.799Z',
        platformId: 'slack:C07F195GB96',
        channelType: 'slack',
        threadId: THREAD_ID,
        content: JSON.stringify({
          text: 'cached alert',
          sender: 'Cleo',
          slackTs: THREAD_TS,
        }),
        trigger: 0,
      });

      exportSessionHistoryFiles(session);

      const exportPath = path.join(GROUPS_DIR_TEST, 'slack-sysops', 'slack_history.json');
      expect(fs.existsSync(exportPath)).toBe(true);
      const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8')) as Array<{ text: string }>;
      expect(exported[0].text).toBe('cached alert');
    });
  });
});
