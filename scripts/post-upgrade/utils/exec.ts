import { execSync, spawnSync } from 'child_process';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runCommand(cmd: string, opts?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): ExecResult {
  try {
    const stdout = execSync(cmd, {
      cwd: opts?.cwd,
      encoding: 'utf8',
      timeout: opts?.timeoutMs ?? 60_000,
      env: { ...process.env, ...opts?.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, stdout: stdout.trim(), stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number; message?: string };
    return {
      ok: false,
      stdout: (e.stdout?.toString('utf8') ?? '').trim(),
      stderr: (e.stderr?.toString('utf8') ?? e.message ?? '').trim(),
      code: e.status ?? 1,
    };
  }
}

export function runPnpmChat(message: string, timeoutMs = 130_000): ExecResult {
  const result = spawnSync('pnpm', ['run', 'chat', message], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    code: result.status,
  };
}

export function gitCommit(): string {
  const r = runCommand('git rev-parse --short HEAD', { timeoutMs: 5000 });
  return r.ok ? r.stdout : 'unknown';
}
