/**
 * Retrieval-gated skills catalog — Tier 2 of the Phase 5 skill lifecycle.
 *
 * Ported from microclaw's skills.rs `build_skills_catalog_for_query()`.
 * Uses token Jaccard overlap to score each skill against the incoming user
 * message, then splits skills into:
 *   - inlined:  top-K highest-scoring (full body included in CLAUDE.md)
 *   - compact:  remaining skills (name + description only)
 *
 * This reduces prompt bloat when skill counts grow while ensuring the most
 * relevant skills are always in full context.
 */
import fs from 'fs';
import path from 'path';

export const DEFAULT_SKILLS_TOP_K = 3;
const COMPACT_MODE_THRESHOLD = 20;
const MAX_INLINED_BODY_CHARS = 4000;

export interface CatalogSkill {
  name: string;
  description: string;
  bodyPath?: string; // Path to the SKILL.md body (for inline rendering)
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1), // skip single-char tokens
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

export interface CatalogResult {
  inlined: Array<{ skill: CatalogSkill; body: string }>;
  compact: CatalogSkill[];
  topK: number;
  totalSkills: number;
}

/**
 * Build a query-aware catalog of skills.
 *
 * @param skills - all available skills with name + description
 * @param query - the user's message text (used for relevance scoring)
 * @param topK - number of skills to inline at full body (default: 3)
 */
export function buildCatalogForQuery(
  skills: CatalogSkill[],
  query: string,
  topK = DEFAULT_SKILLS_TOP_K,
): CatalogResult {
  if (skills.length === 0) {
    return { inlined: [], compact: [], topK, totalSkills: 0 };
  }

  // No query or very short — return compact-only (no inline preference).
  if (!query || query.trim().length < 5) {
    return { inlined: [], compact: skills, topK, totalSkills: skills.length };
  }

  const queryTokens = tokenize(query);

  // Score all skills.
  const scored = skills.map((skill) => ({
    skill,
    score: jaccard(queryTokens, tokenize(`${skill.name} ${skill.description}`)),
  }));

  // Sort by score descending.
  scored.sort((a, b) => b.score - a.score);

  const hot = scored.filter((s) => s.score > 0).slice(0, topK);
  const cold = scored.filter((s, i) => !hot.includes(s));

  // Read inline bodies for hot skills.
  const inlined: CatalogResult['inlined'] = hot.map(({ skill }) => {
    let body = '';
    if (skill.bodyPath && fs.existsSync(skill.bodyPath)) {
      try {
        const raw = fs.readFileSync(skill.bodyPath, 'utf8');
        // Strip frontmatter.
        const bodyStart = raw.indexOf('---', 3);
        body = (bodyStart > -1 ? raw.slice(bodyStart + 3) : raw).trim();
        if (body.length > MAX_INLINED_BODY_CHARS) {
          body = body.slice(0, MAX_INLINED_BODY_CHARS) + '\n[...truncated...]';
        }
      } catch {
        body = '';
      }
    }
    return { skill, body };
  });

  // Compact mode when there are many cold skills.
  const compact: CatalogSkill[] = cold.map((s) => s.skill);
  if (compact.length > COMPACT_MODE_THRESHOLD) {
    // Further trim — only include skills with at least partial relevance.
    return {
      inlined,
      compact: compact.slice(0, COMPACT_MODE_THRESHOLD),
      topK,
      totalSkills: skills.length,
    };
  }

  return { inlined, compact, topK, totalSkills: skills.length };
}

/**
 * Render catalog result as a markdown block for injection into CLAUDE.md
 * or an OpenCode instructions snippet.
 */
export function renderCatalogBlock(result: CatalogResult): string {
  if (result.totalSkills === 0) return '';

  const lines: string[] = [];

  if (result.inlined.length > 0) {
    lines.push('## Relevant Skills (full context)');
    lines.push('');
    for (const { skill, body } of result.inlined) {
      lines.push(`### ${skill.name}`);
      if (skill.description) lines.push(`> ${skill.description}`);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    }
  }

  if (result.compact.length > 0) {
    if (result.inlined.length > 0) {
      lines.push('## Other Available Skills');
    } else {
      lines.push('## Available Skills');
    }
    lines.push('');
    for (const skill of result.compact) {
      lines.push(`- **${skill.name}**: ${skill.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
