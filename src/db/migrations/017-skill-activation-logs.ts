import type Database from 'better-sqlite3';
import type { Migration } from './index.js';

export const migration017: Migration = {
  version: 17,
  name: 'skill-activation-logs',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skill_activation_logs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_group_id TEXT NOT NULL,
        skill_name     TEXT NOT NULL,
        session_id     TEXT,
        activated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_sal_agent_skill
        ON skill_activation_logs (agent_group_id, skill_name);

      CREATE INDEX IF NOT EXISTS idx_sal_activated_at
        ON skill_activation_logs (activated_at);
    `);
  },
};
