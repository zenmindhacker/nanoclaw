#!/usr/bin/env node
/**
 * create-pending-linear-issues.ts
 *
 * CLI for creating approved Linear issues from pending-actions files.
 * Used by the sysops agent (Cleo) after human approval.
 *
 * Usage:
 *   create-pending-linear-issues.ts <pending-id> --all
 *   create-pending-linear-issues.ts <pending-id> --items 1,3,5
 *   create-pending-linear-issues.ts <pending-id> --skip
 *   create-pending-linear-issues.ts --list           # list all pending
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const SKILLS_ROOT = process.env.SKILLS_ROOT || '/workspace/extra/skills';
const PENDING_DIR = join(SKILLS_ROOT, 'transcript-sync', '.pending-actions');
const ROUTER = join(SKILLS_ROOT, 'linear/scripts/linear-router.sh');

interface PendingActionItem {
  index: number;
  title: string;
  context: string;
  assignee: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  project: string;
}

interface PendingMeeting {
  id: string;
  meetingTitle: string;
  meetingDate: string;
  org: string;
  sourceRel: string;
  targetDir: string;
  transcriptPath: string;
  lineageTag: string;
  actions: PendingActionItem[];
  createdAt: string;
  status: 'pending' | 'processing' | 'completed' | 'skipped';
  processedAt?: string;
  processedItems?: number[];
}

function listPending(): void {
  if (!existsSync(PENDING_DIR)) {
    console.log('No pending actions directory found.');
    return;
  }

  const files = readdirSync(PENDING_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No pending action files.');
    return;
  }

  for (const f of files) {
    try {
      const data: PendingMeeting = JSON.parse(readFileSync(join(PENDING_DIR, f), 'utf-8'));
      const actionCount = data.actions?.length || 0;
      console.log(`${data.status === 'pending' ? '⏳' : data.status === 'completed' ? '✅' : '⏭️'} ${data.id} — ${data.meetingTitle} (${data.org}) — ${actionCount} action(s) — ${data.status}`);
    } catch {
      console.log(`⚠️ ${f} — could not parse`);
    }
  }
}

function createIssue(
  org: string,
  title: string,
  description: string,
  assignee: string,
  priority: string,
  project: string,
  lineageTag: string,
  meetingTitle: string,
  meetingDate: string,
  sourceRel: string
): { stdout: string; stderr: string; status: number } {
  const lineageInfo = `Based on transcript from "${meetingTitle}" on ${meetingDate}`;
  const fullDescription = `${description}\n\n---\n${lineageInfo}\nSource: ${sourceRel}\nLineage: ${lineageTag}`;

  const cmd = [
    ROUTER,
    org,
    'create-smart',
    title,
    fullDescription,
    '--state', 'backlog',
    '--priority', priority,
    '--project', project,
    '--labels', 'OpenClaw',
    '--assignee', assignee,
    '--no-milestone',
    '--yes',
  ];

  const cmdStr = cmd.map(s => `"${s.replace(/"/g, '\\"')}"`).join(' ');

  try {
    const stdout = execSync(cmdStr, { encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
    return { stdout, stderr: '', status: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      status: error.status || 1,
    };
  }
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.length === 0) {
    listPending();
    return;
  }

  const pendingId = args[0];
  const pendingPath = join(PENDING_DIR, `${pendingId}.json`);

  if (!existsSync(pendingPath)) {
    console.error(`Pending file not found: ${pendingId}`);
    console.error(`Available files in ${PENDING_DIR}:`);
    listPending();
    process.exit(1);
  }

  const pending: PendingMeeting = JSON.parse(readFileSync(pendingPath, 'utf-8'));

  if (pending.status !== 'pending') {
    console.log(`Already ${pending.status}: ${pendingId}`);
    if (pending.processedItems) {
      console.log(`Previously processed items: ${pending.processedItems.join(', ')}`);
    }
    return;
  }

  // --skip: mark as skipped
  if (args.includes('--skip')) {
    pending.status = 'skipped';
    pending.processedAt = new Date().toISOString();
    writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
    console.log(`Skipped: ${pendingId}`);
    return;
  }

  // Determine which items to create
  let selectedIndices: number[] = [];

  if (args.includes('--all')) {
    selectedIndices = pending.actions.map(a => a.index);
  } else {
    const itemsIdx = args.indexOf('--items');
    if (itemsIdx === -1 || !args[itemsIdx + 1]) {
      console.error('Usage: create-pending-linear-issues.ts <id> --all | --items 1,3,5 | --skip');
      process.exit(1);
    }
    selectedIndices = args[itemsIdx + 1].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
  }

  const actions = pending.actions.filter(a => selectedIndices.includes(a.index));

  if (actions.length === 0) {
    console.error(`No matching actions for indices: ${selectedIndices.join(', ')}`);
    console.error(`Available: ${pending.actions.map(a => a.index).join(', ')}`);
    process.exit(1);
  }

  console.log(`Creating ${actions.length} issue(s) for ${pending.org}...`);

  const created: number[] = [];
  const failed: number[] = [];

  for (const a of actions) {
    const res = createIssue(
      pending.org,
      a.title,
      a.context,
      a.assignee,
      a.priority,
      a.project,
      pending.lineageTag,
      pending.meetingTitle,
      pending.meetingDate,
      pending.sourceRel
    );

    if (res.status === 0) {
      created.push(a.index);
      const issueId = res.stdout.match(/([A-Z]+-\d+)/)?.[1] || '';
      console.log(`✅ ${a.index}. ${a.title} → ${a.assignee} [${a.project}] ${issueId}`);
    } else {
      failed.push(a.index);
      const err = res.stderr.trim().split('\n')[0] || 'unknown error';
      console.log(`❌ ${a.index}. ${a.title} — ${err}`);
    }
  }

  // Update pending file
  pending.status = failed.length === 0 ? 'completed' : 'processing';
  pending.processedAt = new Date().toISOString();
  pending.processedItems = [...(pending.processedItems || []), ...created];
  writeFileSync(pendingPath, JSON.stringify(pending, null, 2));

  console.log(`\nDone: ${created.length} created, ${failed.length} failed`);
}

main();
