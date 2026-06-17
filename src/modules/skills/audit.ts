/**
 * Deterministic skill audit — no LLM calls.
 *
 * Ported from microclaw's skill_audit.rs. Scans agent-created skills in a
 * group's skills/ directory and reports issues without making any writes.
 *
 * Issues detected:
 * - near-duplicate: token Jaccard similarity >= 0.5 between any two skills
 * - thin: SKILL.md body < 80 chars
 * - stale: source=agent-created + last_used > STALE_DAYS
 * - over-cap: agent-created count >= MAX_AGENT_CREATED_SKILLS
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../../config.js';
import { getDb } from '../../db/connection.js';

export const MAX_AGENT_CREATED_SKILLS = 20;
export const STALE_DAYS = 30;
const THIN_BODY_CHARS = 80;
const JACCARD_WARN_THRESHOLD = 0.5;

export interface SkillMeta {
  name: string;
  description: string;
  source: 'agent-created' | 'human' | string;
  version?: number;
  created_at?: string;
  last_used?: string;
  bodyChars: number;
  skillPath: string;
}

export interface AuditIssue {
  severity: 'warn' | 'info';
  skill: string;
  issue: string;
  detail?: string;
}

export interface AuditResult {
  agentGroupId: string;
  folder: string;
  totalSkills: number;
  agentCreatedCount: number;
  issues: AuditIssue[];
}

function parseFrontmatter(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const kv = /^(\w[\w_-]*):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return meta;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function readSkillsFromDir(skillsDir: string): SkillMeta[] {
  if (!fs.existsSync(skillsDir)) return [];
  const results: SkillMeta[] = [];

  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) continue;

    const text = fs.readFileSync(skillMdPath, 'utf8');
    const meta = parseFrontmatter(text);
    const bodyStart = text.indexOf('---', 3);
    const body = bodyStart > -1 ? text.slice(bodyStart + 3).trim() : text.trim();

    results.push({
      name: entry.name,
      description: meta.description ?? '',
      source: meta.source ?? 'human',
      version: meta.version ? Number(meta.version) : undefined,
      created_at: meta.created_at,
      last_used: meta.last_used,
      bodyChars: body.length,
      skillPath: path.join(skillsDir, entry.name),
    });
  }

  return results;
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

export function auditGroupSkills(agentGroupId: string, folder: string): AuditResult {
  const skillsDir = path.join(GROUPS_DIR, folder, 'skills');
  const skills = readSkillsFromDir(skillsDir);
  const issues: AuditIssue[] = [];

  const agentCreated = skills.filter((s) => s.source === 'agent-created');
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  // Over-cap check
  if (agentCreated.length >= MAX_AGENT_CREATED_SKILLS) {
    issues.push({
      severity: 'warn',
      skill: '_group_',
      issue: 'over-cap',
      detail: `${agentCreated.length}/${MAX_AGENT_CREATED_SKILLS} agent-created skills — at or above cap`,
    });
  } else if (agentCreated.length >= MAX_AGENT_CREATED_SKILLS - 5) {
    issues.push({
      severity: 'info',
      skill: '_group_',
      issue: 'approaching-cap',
      detail: `${agentCreated.length}/${MAX_AGENT_CREATED_SKILLS} agent-created skills`,
    });
  }

  for (const skill of skills) {
    // Thin body
    if (skill.bodyChars < THIN_BODY_CHARS) {
      issues.push({ severity: 'warn', skill: skill.name, issue: 'thin-body', detail: `${skill.bodyChars} chars` });
    }

    // Stale (agent-created only)
    if (skill.source === 'agent-created') {
      const lastActivation = getLastActivation(agentGroupId, skill.name);
      const lastActivityDate = lastActivation ?? (skill.last_used ? new Date(skill.last_used) : null);
      if (!lastActivityDate || lastActivityDate < staleCutoff) {
        const daysAgo = lastActivityDate
          ? Math.floor((Date.now() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000))
          : null;
        issues.push({
          severity: 'warn',
          skill: skill.name,
          issue: 'stale',
          detail: daysAgo !== null ? `last used ${daysAgo} days ago` : 'never used',
        });
      }
    }
  }

  // Near-duplicate pairs
  const tokens = skills.map((s) => tokenize(`${s.name} ${s.description}`));
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const sim = jaccard(tokens[i], tokens[j]);
      if (sim >= JACCARD_WARN_THRESHOLD) {
        issues.push({
          severity: 'warn',
          skill: skills[i].name,
          issue: 'near-duplicate',
          detail: `similar to ${skills[j].name} (Jaccard ${sim.toFixed(2)})`,
        });
      }
    }
  }

  return {
    agentGroupId,
    folder,
    totalSkills: skills.length,
    agentCreatedCount: agentCreated.length,
    issues,
  };
}

/** Log a skill activation to the central DB. */
export function logSkillActivation(agentGroupId: string, skillName: string, sessionId?: string): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO skill_activation_logs (agent_group_id, skill_name, session_id, activated_at)
                VALUES (?, ?, ?, datetime('now'))`,
    ).run(agentGroupId, skillName, sessionId ?? null);
  } catch {
    // Best-effort; never block on activation logging.
  }
}
