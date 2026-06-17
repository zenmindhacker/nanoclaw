import path from 'path';

import { LINEAR_CONTAINER_ENV } from '../../../src/config.js';
import type { RunContext } from '../types.js';
import { syncTimedCheck } from '../report.js';
import type { CheckResult } from '../types.js';
import { execInContainer, findRunningContainer } from '../utils/container.js';
import { runCommand } from '../utils/exec.js';

export async function runSkillsReadonlyChecks(ctx: RunContext): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  let container = ctx.containerName ?? findRunningContainer(ctx.agentGroupFolder);

  for (const skill of ctx.manifest.skillCommands) {
    checks.push(
      syncTimedCheck(`skills.${skill.id}`, 1, () => {
        if (container) {
          const r = execInContainer(container, skill.cmd, skill.cwd);
          if (r.ok) return { status: 'pass', message: r.stdout.slice(0, 200) };
          return { status: 'fail', message: `${skill.id} failed in container`, detail: r.stderr || r.stdout };
        }

        // Fallback: host paths for repo-local skills / group scripts
        const hostCmd = skill.cmd
          .replace('/workspace/extra/skills/', 'skills/')
          .replace('/workspace/agent/', `agents/${ctx.agent}/groups/${ctx.agentGroupFolder}/`);
        const r = runCommand(hostCmd, {
          cwd: skill.cwd ? process.cwd() : process.cwd(),
          timeoutMs: 60_000,
          env: {
            ...LINEAR_CONTAINER_ENV,
            SKILLS_ROOT: path.join(process.cwd(), 'skills'),
          },
        });
        if (r.ok) return { status: 'pass', message: 'ran on host (no container)', detail: r.stdout.slice(0, 200) };
        return {
          status: 'skip',
          message: 'No running container and host fallback failed',
          detail: r.stderr || r.stdout,
        };
      }),
    );
  }

  return checks;
}
