/**
 * Agent-global identity layer — shared across all agent groups on one install.
 *
 * Cleo and Silas each have a `groups/global/` tree (under GROUPS_DIR) holding:
 *   - CLAUDE.md        — git-tracked persona (read-only in container)
 *   - CLAUDE.local.md  — agent-writable personality / evolution
 *   - wiki/            — unified knowledge base
 *   - mnemon/          — unified memory graph (MNEMON_DATA_DIR)
 *
 * Channel-specific groups keep only CLAUDE.local.md for wiring overrides.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from './config.js';

export function agentGlobalDir(): string {
  return path.join(GROUPS_DIR, 'global');
}

export function agentGlobalWikiDir(): string {
  return path.join(agentGlobalDir(), 'wiki');
}

export function agentGlobalMnemonDir(): string {
  return path.join(agentGlobalDir(), 'mnemon');
}

/** Container paths (stable regardless of GROUPS_DIR on host). */
export const GLOBAL_CONTAINER_PATH = '/workspace/global';
export const GLOBAL_WIKI_CONTAINER_PATH = `${GLOBAL_CONTAINER_PATH}/wiki`;
export const GLOBAL_MNEMON_CONTAINER_PATH = `${GLOBAL_CONTAINER_PATH}/mnemon`;

/** Relative import from `groups/<folder>/CLAUDE.md` → `groups/global/`. */
export const GLOBAL_CLAUDE_IMPORT = '@../global/CLAUDE.md';
export const GLOBAL_CLAUDE_LOCAL_IMPORT = '@../global/CLAUDE.local.md';

const DEFAULT_LOCAL_HEADER = `# Agent-local memory

Personality evolution, cross-group preferences, and durable notes that apply
everywhere this agent operates. Edit freely — this file is yours.

The git-tracked persona lives in \`CLAUDE.md\` (read-only in container).
`;

/** Idempotent scaffold for global identity dirs. Safe on every spawn/startup. */
export function ensureAgentGlobalScaffold(): void {
  const globalDir = agentGlobalDir();
  fs.mkdirSync(globalDir, { recursive: true });

  const localFile = path.join(globalDir, 'CLAUDE.local.md');
  if (!fs.existsSync(localFile)) {
    fs.writeFileSync(localFile, DEFAULT_LOCAL_HEADER);
  }

  const wikiDir = agentGlobalWikiDir();
  fs.mkdirSync(path.join(wikiDir, 'sources'), { recursive: true });

  const indexFile = path.join(wikiDir, 'index.md');
  if (!fs.existsSync(indexFile)) {
    fs.writeFileSync(
      indexFile,
      `# Wiki Index

Content catalog. Update on every ingest.

| Page | Summary | Updated |
|------|---------|---------|
| *(empty — first ingest will populate this)* | | |
`,
    );
  }

  const logFile = path.join(wikiDir, 'log.md');
  if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '# Wiki Log\n\nAppend-only activity log.\n');
  }

  fs.mkdirSync(agentGlobalMnemonDir(), { recursive: true });

  const mnemonPromptDir = path.join(agentGlobalMnemonDir(), 'prompt');
  fs.mkdirSync(mnemonPromptDir, { recursive: true });
  const guideFile = path.join(mnemonPromptDir, 'guide.md');
  if (!fs.existsSync(guideFile)) {
    fs.writeFileSync(
      guideFile,
      `# Mnemon guide

You have access to a persistent knowledge graph via the \`mnemon\` CLI tool.
- Before tasks that benefit from past context: run \`mnemon recall "<brief query>"\`.
- After substantive decisions, preferences, or learned facts: run \`mnemon remember "<compact entry>"\`.
- For entity relationships: \`mnemon link\`.
- To inspect memory state: \`mnemon status\`.

Keep entries short and factual. Do not duplicate long procedures from CLAUDE.local.md.
`,
    );
  }
}
