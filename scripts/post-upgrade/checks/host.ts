import fs from 'fs';
import path from 'path';

import { CONTAINER_IMAGE, DATA_DIR, GROUPS_DIR } from '../../../src/config.js';
import { getTokenHealth } from '../../../src/extensions/oauth/refresher.js';
import type { RunContext } from '../types.js';
import { syncTimedCheck } from '../report.js';
import type { CheckResult } from '../types.js';
import { runCommand } from '../utils/exec.js';

export async function runHostChecks(ctx: RunContext): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  checks.push(
    syncTimedCheck('host.service', 1, () => {
      const r = runCommand('systemctl --user is-active nanoclaw 2>/dev/null || launchctl list 2>/dev/null | grep -i nanoclaw', {
        timeoutMs: 10_000,
      });
      const active =
        r.stdout.includes('active') ||
        r.stdout.includes('running') ||
        /com\.nanoclaw/.test(r.stdout);
      if (!active) {
        // Fallback: is CLI socket present?
        const sock = path.join(DATA_DIR, 'cli.sock');
        if (fs.existsSync(sock)) {
          return { status: 'warn', message: 'Service status unclear but CLI socket exists' };
        }
        return { status: 'fail', message: 'NanoClaw service not active and no CLI socket', detail: r.stderr || r.stdout };
      }
      return { status: 'pass', message: 'Host service appears active' };
    }),
  );

  checks.push(
    syncTimedCheck('host.docker', 1, () => {
      const r = runCommand('docker info >/dev/null 2>&1 && echo ok', { timeoutMs: 15_000 });
      if (!r.ok) return { status: 'fail', message: 'Docker not reachable', detail: r.stderr };
      return { status: 'pass' };
    }),
  );

  checks.push(
    syncTimedCheck('host.container-image', 1, () => {
      const r = runCommand(`docker image inspect ${CONTAINER_IMAGE} >/dev/null 2>&1 && echo ok`, { timeoutMs: 15_000 });
      if (!r.ok) {
        return { status: 'fail', message: `Agent image missing: ${CONTAINER_IMAGE}`, detail: r.stderr };
      }
      return { status: 'pass', message: CONTAINER_IMAGE };
    }),
  );

  checks.push(
    syncTimedCheck('host.log-fatal', 1, () => {
      const logPath = path.join(process.cwd(), 'logs', 'nanoclaw.error.log');
      if (!fs.existsSync(logPath)) {
        return { status: 'pass', message: 'No error log file' };
      }
      const tail = fs.readFileSync(logPath, 'utf8').slice(-4000);
      if (/\bFATAL\b/i.test(tail)) {
        return { status: 'warn', message: 'Recent FATAL in nanoclaw.error.log', detail: tail.slice(-500) };
      }
      return { status: 'pass' };
    }),
  );

  if (ctx.agent === 'silas') {
    checks.push(
      syncTimedCheck('host.family-repo', 1, () => {
        const familyPath = path.join(process.env.HOME || '', 'repos', 'family');
        if (!fs.existsSync(familyPath)) {
          return { status: 'fail', message: `Missing ~/repos/family at ${familyPath}` };
        }
        const r = runCommand(`git -C "${familyPath}" remote get-url origin`, { timeoutMs: 5000 });
        if (/placeholder/i.test(r.stdout)) {
          return { status: 'fail', message: 'family repo remote still has placeholder token', detail: r.stdout };
        }
        return { status: 'pass', message: familyPath };
      }),
    );

    checks.push(
      syncTimedCheck('host.cycle-task-audit', 1, () => {
        const r = runCommand('pnpm exec tsx scripts/audit-scheduled-tasks.ts 2>&1 | grep -c "cycle-daily-briefing.*pending"', {
          timeoutMs: 30_000,
          cwd: process.cwd(),
        });
        const count = parseInt(r.stdout.trim(), 10);
        if (Number.isNaN(count) || count === 0) {
          return { status: 'fail', message: 'No pending cycle-daily-briefing task found', detail: r.stdout.slice(0, 300) };
        }
        if (count > 1) {
          return { status: 'fail', message: `${count} pending cycle-daily-briefing tasks (expected 1)`, detail: r.stdout.slice(0, 300) };
        }
        return { status: 'pass', message: 'One pending cycle-daily-briefing task' };
      }),
    );
  }

  if (ctx.agent === 'cleo') {
    checks.push(
      syncTimedCheck('host.oauth-health', 1, () => {
        try {
          const health = getTokenHealth();
          const bad = health.filter((h) => h.status === 'error' || h.status === 'expired');
          if (bad.length > 0) {
            return {
              status: 'warn',
              message: `${bad.length} OAuth token(s) need attention`,
              detail: bad.map((b) => `${b.id}: ${b.status}`).join(', '),
            };
          }
          return { status: 'pass', message: `${health.length} token(s) checked` };
        } catch (err) {
          return { status: 'warn', message: 'OAuth health check failed', detail: String(err) };
        }
      }),
    );
  }

  checks.push(
    syncTimedCheck('host.groups-dir', 1, () => {
      const groupPath = path.join(GROUPS_DIR, ctx.agentGroupFolder);
      if (!fs.existsSync(groupPath)) {
        return { status: 'fail', message: `Group folder missing: ${groupPath}` };
      }
      return { status: 'pass', message: groupPath };
    }),
  );

  return checks;
}
