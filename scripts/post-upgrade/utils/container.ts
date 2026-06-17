import path from 'path';

import { CONTAINER_IMAGE, DATA_DIR } from '../../../src/config.js';
import { runCommand } from './exec.js';

/** Find a running session container for the given agent group folder. */
export function findRunningContainer(folder: string): string | null {
  const filter = `nanoclaw-v2-${folder}-`;
  const r = runCommand(`docker ps --filter name=${filter} --format "{{.Names}}"`, { timeoutMs: 10_000 });
  if (!r.ok) return null;
  const name = r.stdout.split('\n').map((s) => s.trim()).find(Boolean);
  return name ?? null;
}

export function execInContainer(containerName: string, shellCmd: string, cwd?: string): ReturnType<typeof runCommand> {
  const cd = cwd ? `cd ${cwd} && ` : '';
  return runCommand(`docker exec ${containerName} bash -lc ${JSON.stringify(`${cd}${shellCmd}`)}`, {
    timeoutMs: 120_000,
  });
}

/** Run a command in the agent image with mnemon data dir mounted (no live session required). */
export function execMnemonOnHost(agentGroupId: string, shellCmd: string): ReturnType<typeof runCommand> {
  const claudeShared = path.join(DATA_DIR, 'v2-sessions', agentGroupId, '.claude-shared');
  const escapedCmd = shellCmd.replace(/'/g, `'\\''`);
  return runCommand(
    `docker run --rm -v '${claudeShared}:/home/node/.claude' -e MNEMON_DATA_DIR=/home/node/.claude/mnemon ${CONTAINER_IMAGE} bash -lc '${escapedCmd}'`,
    { timeoutMs: 120_000 },
  );
}

export function mnemonGuidePath(agentGroupId: string): string {
  return path.join(DATA_DIR, 'v2-sessions', agentGroupId, '.claude-shared', 'mnemon', 'prompt', 'guide.md');
}
