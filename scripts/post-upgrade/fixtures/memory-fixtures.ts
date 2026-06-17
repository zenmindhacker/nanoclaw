/**
 * Ephemeral memory fixtures for Tier 2 CLI recall tests.
 * Each layer gets a unique project name + token so we can verify real recall,
 * not scripted capability answers.
 */
import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../../../src/config.js';
import { agentGlobalDir, agentGlobalMnemonDir, agentGlobalWikiDir } from '../../../src/agent-global.js';
import { UPGRADE_TEST_PREFIX } from '../manifest.js';
import type { RunContext } from '../types.js';
import { execInContainer, execMnemonOnHost, findRunningContainer } from '../utils/container.js';

export interface MemoryFixture {
  nonce: string;
  projectName: string;
  blocker: string;
  token: string;
}

const LOCAL_MARKER_START = '<!-- upgrade-harness:local:start -->';
const LOCAL_MARKER_END = '<!-- upgrade-harness:local:end -->';

export function createMemoryFixture(ctx: RunContext): MemoryFixture {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    nonce,
    projectName: `Project Zephyr-${nonce}`,
    blocker: 'oauth refresh token expired',
    token: `${UPGRADE_TEST_PREFIX}_${nonce}`,
  };
}

function rememberMnemon(ctx: RunContext, text: string): { ok: boolean; detail: string } {
  const cmd = `mnemon remember ${JSON.stringify(text)}`;
  const container = ctx.containerName ?? findRunningContainer(ctx.agentGroupFolder);
  const run = container ? execInContainer(container, cmd) : execMnemonOnHost(ctx.agentGroupId, cmd);
  return { ok: run.ok, detail: run.stderr || run.stdout };
}

export function seedMnemonFixture(ctx: RunContext, fixture: MemoryFixture): { ok: boolean; detail: string } {
  const text = `${fixture.projectName}: ${fixture.blocker}. Token ${fixture.token}.`;
  return rememberMnemon(ctx, text);
}

export function seedWikiFixture(_ctx: RunContext, fixture: MemoryFixture): void {
  const wikiRoot = agentGlobalWikiDir();
  const pagesDir = path.join(wikiRoot, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const pagePath = path.join(pagesDir, `harness-${fixture.nonce}.md`);
  fs.writeFileSync(
    pagePath,
    `# ${fixture.projectName}\n\nUpgrade harness fixture. Blocker: ${fixture.blocker}.\n\nVerification token: ${fixture.token}\n`,
  );

  const indexPath = path.join(wikiRoot, 'index.md');
  const row = `| [${fixture.projectName}](pages/harness-${fixture.nonce}.md) | Harness fixture — ${fixture.blocker} | ${new Date().toISOString().slice(0, 10)} |`;
  if (fs.existsSync(indexPath)) {
    let index = fs.readFileSync(indexPath, 'utf8');
    if (!index.includes(fixture.token)) {
      index = index.replace(
        '| *(empty — first ingest will populate this)* | | |',
        row,
      );
      if (!index.includes(fixture.token)) {
        index += `\n${row}\n`;
      }
      fs.writeFileSync(indexPath, index);
    }
  }
}

export function seedLocalFixture(_ctx: RunContext, fixture: MemoryFixture): void {
  const localPath = path.join(agentGlobalDir(), 'CLAUDE.local.md');
  const block = [
    LOCAL_MARKER_START,
    `## Harness fixture ${fixture.nonce}`,
    `${fixture.projectName}: ${fixture.blocker}. Token ${fixture.token}.`,
    LOCAL_MARKER_END,
    '',
  ].join('\n');

  let content = fs.existsSync(localPath) ? fs.readFileSync(localPath, 'utf8') : '';
  if (content.includes(LOCAL_MARKER_START)) {
    const start = content.indexOf(LOCAL_MARKER_START);
    const end = content.indexOf(LOCAL_MARKER_END);
    if (end >= 0) {
      content = content.slice(0, start) + block + content.slice(end + LOCAL_MARKER_END.length);
    } else {
      content = content.slice(0, start) + block;
    }
  } else {
    content = `${content.trimEnd()}\n\n${block}`;
  }
  fs.writeFileSync(localPath, content);
}

/** Simulates prior thread context exported to slack_history.json (host sync path). */
export function seedThreadHistoryFixture(ctx: RunContext, fixture: MemoryFixture): void {
  const groupDir = path.join(GROUPS_DIR, ctx.agentGroupFolder);
  fs.mkdirSync(groupDir, { recursive: true });
  const exportPath = path.join(groupDir, 'slack_history.json');
  const entry = {
    ts: `${Date.now()}.000001`,
    timestamp: new Date().toISOString(),
    sender: 'Cleo',
    text: `*${fixture.projectName}* — alert in #sysops thread. Blocker: ${fixture.blocker}. Ref ${fixture.token}.`,
    threadId: `slack:C07F195GB96:${Date.now()}.000001`,
    syncedFromSlack: true,
  };
  fs.writeFileSync(exportPath, JSON.stringify([entry], null, 2));
}

export function cleanupLocalFixture(): void {
  const localPath = path.join(agentGlobalDir(), 'CLAUDE.local.md');
  if (!fs.existsSync(localPath)) return;
  const content = fs.readFileSync(localPath, 'utf8');
  const start = content.indexOf(LOCAL_MARKER_START);
  if (start < 0) return;
  const end = content.indexOf(LOCAL_MARKER_END);
  if (end < 0) return;
  const next = content.slice(0, start) + content.slice(end + LOCAL_MARKER_END.length).trimStart();
  fs.writeFileSync(localPath, next.endsWith('\n') ? next : `${next}\n`);
}

export function cleanupThreadHistoryFixture(ctx: RunContext): void {
  const exportPath = path.join(GROUPS_DIR, ctx.agentGroupFolder, 'slack_history.json');
  if (fs.existsSync(exportPath)) {
    try {
      fs.unlinkSync(exportPath);
    } catch {
      /* best effort */
    }
  }
}

export function cleanupWikiFixture(fixture: MemoryFixture): void {
  const wikiRoot = agentGlobalWikiDir();
  const pagePath = path.join(wikiRoot, 'pages', `harness-${fixture.nonce}.md`);
  if (fs.existsSync(pagePath)) fs.unlinkSync(pagePath);
}

export function replyContainsFixture(reply: string, fixture: MemoryFixture, requireToken = false): boolean {
  const lower = reply.toLowerCase();
  if (lower.includes(fixture.token.toLowerCase())) return true;
  if (requireToken) return false;
  if (lower.includes(fixture.blocker.toLowerCase())) return true;
  if (lower.includes('oauth') && lower.includes('refresh')) return true;
  return false;
}
