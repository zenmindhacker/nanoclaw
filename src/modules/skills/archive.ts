/**
 * Agent-created skill archiver.
 *
 * Ported from microclaw's skill_review.rs `archive_inactive_agent_skills()`.
 * Moves stale `source: agent-created` skills to `skills/.archived/<name>-<ts>/`
 * so they don't accumulate forever.
 *
 * Called from host-sweep on a daily tick.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../../config.js';
import { getDb } from '../../db/connection.js';
import { log } from '../../log.js';
import { MAX_AGENT_CREATED_SKILLS, STALE_DAYS } from './audit.js';

const GRACE_PERIOD_DAYS = 7; // Newly created skills are never archived within grace period.

function parseFrontmatterSource(text: string): string {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!match) return 'human';
  const line = match[1].split('\n').find((l) => /^source\s*:/.test(l.trim()));
  return line
    ? line
        .split(':')[1]
        .trim()
        .replace(/^['"]|['"]$/g, '')
    : 'human';
}

function getLastActivation(agentGroupId: string, skillName: string): Date | null {
  try {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT activated_at FROM skill_activation_logs
         WHERE agent_group_id = ? AND skill_name = ?
         ORDER BY activated_at DESC LIMIT 1`,
      )
      .get(agentGroupId, skillName) as { activated_at: string } | undefined;
    return row ? new Date(row.activated_at) : null;
  } catch {
    return null;
  }
}

function shouldArchive(skillDir: string, agentGroupId: string, skillName: string): boolean {
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return false;

  const text = fs.readFileSync(skillMdPath, 'utf8');
  if (parseFrontmatterSource(text) !== 'agent-created') return false;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_DAYS * 24 * 60 * 60 * 1000);
  const graceCutoff = new Date(now - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  // Respect grace period based on file mtime.
  const mtime = fs.statSync(skillMdPath).mtime;
  if (mtime > graceCutoff) return false;

  // Archive if no activation since cutoff.
  const lastActivation = getLastActivation(agentGroupId, skillName);
  if (lastActivation && lastActivation > staleCutoff) return false;

  return true;
}

export function archiveStaleSkills(agentGroupId: string, folder: string): string[] {
  const skillsDir = path.join(GROUPS_DIR, folder, 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const archived: string[] = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillDir = path.join(skillsDir, entry.name);

    if (!shouldArchive(skillDir, agentGroupId, entry.name)) continue;

    const archivedDir = path.join(skillsDir, '.archived', `${entry.name}-${timestamp}`);
    try {
      fs.mkdirSync(path.dirname(archivedDir), { recursive: true });
      fs.renameSync(skillDir, archivedDir);
      archived.push(entry.name);
      log.info('Archived stale agent-created skill', {
        agentGroupId,
        folder,
        skill: entry.name,
        archivedTo: archivedDir,
      });
    } catch (err) {
      log.warn('Failed to archive skill', { agentGroupId, skill: entry.name, err });
    }
  }

  return archived;
}

/** Check if archive sweep should run (env-configurable, default 30-day cutoff). */
export function isArchiveEnabled(): boolean {
  const days = parseInt(process.env.SKILL_ARCHIVE_AFTER_DAYS ?? '30', 10);
  return !isNaN(days) && days > 0;
}

/** Sweep all active agent groups. Called from host-sweep on a daily tick. */
export async function sweepSkillArchives(groups: Array<{ id: string; folder: string }>): Promise<void> {
  if (!isArchiveEnabled()) return;

  let totalArchived = 0;
  for (const group of groups) {
    const archived = archiveStaleSkills(group.id, group.folder);
    totalArchived += archived.length;
  }

  if (totalArchived > 0) {
    log.info('Skill archive sweep complete', {
      totalArchived,
      maxSkills: MAX_AGENT_CREATED_SKILLS,
    });
  }
}
