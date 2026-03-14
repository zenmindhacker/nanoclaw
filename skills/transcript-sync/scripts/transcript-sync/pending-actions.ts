/**
 * Pending actions — extracts action items from transcripts and saves them
 * for human-in-the-loop approval via #sysops before creating Linear issues.
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { TRANSCRIPT_TASKS_SCRIPT } from './config.js';
import { logInfo, logWarn } from './logger.js';
import { slugify } from './helpers.js';
import type { PendingActionItem, PendingMeeting } from './types.js';

export const PENDING_ACTIONS_DIR = join(
  process.env.SKILLS_ROOT || '/workspace/extra/skills',
  'transcript-sync', '.pending-actions'
);
export const SYSOPS_JID = 'slack:C07F195GB96';
export const PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — auto-deleted after

export function cleanStalePendingFiles(): void {
  if (!existsSync(PENDING_ACTIONS_DIR)) return;
  const now = Date.now();
  for (const f of readdirSync(PENDING_ACTIONS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const fp = join(PENDING_ACTIONS_DIR, f);
    try {
      const stat = statSync(fp);
      if (now - stat.mtimeMs > PENDING_TTL_MS) {
        unlinkSync(fp);
        logInfo(`[pending] cleaned stale: ${f}`);
      }
    } catch { /* ignore */ }
  }
}

export async function extractAndSavePendingActions(
  transcriptPath: string,
  targetDir: string,
  meetingTitle: string,
  meetingDate: string,
  tasksMode: string,
  minConfidence: number,
  maxItems: number
): Promise<PendingMeeting | null> {
  if (tasksMode === 'off') return null;

  const scriptPath = TRANSCRIPT_TASKS_SCRIPT;
  if (!existsSync(scriptPath)) {
    logInfo(`[tasks] script missing: ${scriptPath}`);
    return null;
  }

  // Check if pending file already exists for this meeting
  const slug = slugify(meetingTitle);
  const pendingId = `ts-${meetingDate}-${slug}`;
  const pendingPath = join(PENDING_ACTIONS_DIR, `${pendingId}.json`);
  if (existsSync(pendingPath)) {
    logInfo(`[pending] already exists: ${pendingId}`);
    return null;
  }

  try {
    const tsxPath = join(dirname(scriptPath), '..', 'node_modules', '.bin', 'tsx');
    const cmd = `"${tsxPath}" "${scriptPath}" "${transcriptPath}" --mode extract-only --max-items ${maxItems}`;
    const output = execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 120000 });

    // Find the JSON line in output (extract-only writes clean JSON)
    const lines = output.trim().split('\n');
    let jsonLine = '';
    for (const line of lines) {
      if (line.startsWith('{')) {
        jsonLine = line;
        break;
      }
    }
    if (!jsonLine) {
      // Log non-JSON output (status messages from the script)
      if (output.trim()) logInfo(output.trim());
      return null;
    }

    const extracted = JSON.parse(jsonLine);
    if (!extracted.actions || extracted.actions.length === 0) {
      logInfo(`[pending] no actions found for: ${meetingTitle}`);
      return null;
    }

    const pending: PendingMeeting = {
      id: pendingId,
      meetingTitle: extracted.meetingMeta?.title || meetingTitle,
      meetingDate: extracted.meetingMeta?.date || meetingDate,
      org: extracted.org,
      sourceRel: extracted.sourceRel,
      targetDir,
      transcriptPath,
      lineageTag: extracted.meetingMeta?.lineageTag || '',
      actions: extracted.actions.map((a: any, i: number) => ({ ...a, index: i + 1 })),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    mkdirSync(PENDING_ACTIONS_DIR, { recursive: true });
    const tmpPath = `${pendingPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(pending, null, 2));
    renameSync(tmpPath, pendingPath);

    logInfo(`[pending] saved ${pending.actions.length} action(s): ${pendingId}`);
    return pending;
  } catch (error: any) {
    if (error.stdout?.trim()) logInfo(error.stdout.trim());
    if (error.status !== 0 && error.stderr?.trim()) {
      logInfo(`[tasks] error: ${error.stderr.trim()}`);
    }
    return null;
  }
}

export function postPendingSummaryToSysops(meetings: PendingMeeting[]): void {
  const ipcDir = '/workspace/ipc';
  const messagesDir = join(ipcDir, 'messages');

  if (!existsSync(ipcDir)) {
    logWarn('[pending] IPC dir not found, cannot post to sysops');
    return;
  }

  // Renumber actions with a global counter across all meetings in this batch
  let globalIdx = 1;
  for (const m of meetings) {
    for (const a of m.actions) {
      a.index = globalIdx++;
    }
    // Persist updated indices so `create 7,9 <id>` works against the file
    const pendingPath = join(PENDING_ACTIONS_DIR, `${m.id}.json`);
    if (existsSync(pendingPath)) {
      try {
        const tmpPath = `${pendingPath}.tmp`;
        writeFileSync(tmpPath, JSON.stringify(m, null, 2));
        renameSync(tmpPath, pendingPath);
      } catch { /* best-effort */ }
    }
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const lines: string[] = [`*transcript-sync* — ${timeStr}`];

  for (const m of meetings) {
    const firstIdx = m.actions[0]?.index ?? 0;
    const lastIdx = m.actions[m.actions.length - 1]?.index ?? 0;
    lines.push('');
    lines.push(`*${m.meetingTitle}* (${m.org})`);
    // Show last 2 path segments for brevity
    const shortDir = m.targetDir.split('/').slice(-3).join('/');
    lines.push(`Routed to \`${shortDir}\``);
    lines.push('');
    lines.push('*Action items detected:*');
    for (const a of m.actions) {
      const name = a.assignee.split('@')[0];
      lines.push(`${a.index}. [${a.priority}] ${a.title} — _${name}_ (${a.project})`);
    }
    lines.push('');
    lines.push(`Reply: \`create all ${m.id}\`, \`create ${firstIdx},${lastIdx} ${m.id}\`, or \`skip ${m.id}\``);
  }

  const message = {
    type: 'message',
    chatJid: SYSOPS_JID,
    text: lines.join('\n'),
    timestamp: now.toISOString(),
  };

  mkdirSync(messagesDir, { recursive: true });
  const filename = `${Date.now()}-pending-actions.json`;
  const filepath = join(messagesDir, filename);
  const tmpPath = `${filepath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(message, null, 2));
  renameSync(tmpPath, filepath);

  logInfo(`[pending] posted ${meetings.length} meeting summary to #sysops`);
}
