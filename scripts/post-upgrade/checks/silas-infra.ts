import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GROUPS_DIR, ONECLI_URL } from '../../../src/config.js';
import type { RunContext } from '../types.js';
import { syncTimedCheck } from '../report.js';
import type { CheckResult } from '../types.js';
import { runCommand } from '../utils/exec.js';

/** Strip embedded proxy credentials (user:pass@host) before surfacing any string in a check result. */
function redactProxyAuth(s: string): string {
  return s.replace(/:\/\/[^/@\s]+@/g, '://<redacted>@');
}

const CANONICAL_CYCLE_SESSION = 'sess-1782170556889-ydslvi';
const LEGACY_SILAS_GROUPS = [
  'christina_dm',
  'christina-dm',
  'slack_christina-dm',
  'main',
  'scheduled-tasks',
];

export function runSilasInfraChecks(ctx: RunContext): CheckResult[] {
  if (ctx.agent !== 'silas') return [];

  const checks: CheckResult[] = [];
  const home = process.env.HOME || '';
  const credPath = path.join(home, '.config/nanoclaw/credentials/services/github-transcript-token');

  checks.push(
    syncTimedCheck('host.github-transcript-token', 1, () => {
      if (!fs.existsSync(credPath)) {
        return { status: 'fail', message: 'Missing github-transcript-token for git push from container', detail: credPath };
      }
      const size = fs.statSync(credPath).size;
      if (size < 10) {
        return { status: 'fail', message: 'github-transcript-token looks empty or truncated', detail: `${size} bytes` };
      }
      return { status: 'pass', message: `${credPath} (${size} bytes)` };
    }),
  );

  checks.push(
    syncTimedCheck('host.no-lane-family-ops', 1, () => {
      const legacy = path.join(home, 'repos', 'lane-family-ops');
      if (fs.existsSync(legacy)) {
        return {
          status: 'fail',
          message: 'Legacy lane-family-ops clone still present — rename to family',
          detail: legacy,
        };
      }
      return { status: 'pass', message: 'No lane-family-ops path under ~/repos' };
    }),
  );

  checks.push(
    syncTimedCheck('host.family-repo-writable', 1, () => {
      const familyPath = path.join(home, 'repos', 'family');
      if (!fs.existsSync(familyPath)) {
        return { status: 'fail', message: 'Missing ~/repos/family', detail: familyPath };
      }
      const probe = path.join(familyPath, '.post-upgrade-mount-ok');
      try {
        fs.writeFileSync(probe, 'ok');
        fs.unlinkSync(probe);
        return { status: 'pass', message: `${familyPath} writable on host` };
      } catch (err) {
        return { status: 'fail', message: 'Cannot write to ~/repos/family on host', detail: String(err) };
      }
    }),
  );

  checks.push(
    syncTimedCheck('git.family-repo-auth', 1, () => {
      if (!ONECLI_URL) {
        return { status: 'skip', message: 'ONECLI_URL not configured' };
      }
      const cc = runCommand(`curl -s "${ONECLI_URL}/v1/container-config?agent=${ctx.agentGroupId}"`, {
        timeoutMs: 10_000,
      });
      if (!cc.ok || !cc.stdout) {
        return {
          status: 'fail',
          message: 'Could not fetch OneCLI container-config for git auth check',
          detail: redactProxyAuth(cc.stderr),
        };
      }
      let config: { env?: Record<string, string>; caCertificate?: string };
      try {
        config = JSON.parse(cc.stdout);
      } catch {
        return { status: 'fail', message: 'OneCLI container-config returned invalid JSON' };
      }
      const proxyRaw = config.env?.HTTPS_PROXY;
      const caCert = config.caCertificate;
      if (!proxyRaw || !caCert) {
        return { status: 'fail', message: 'OneCLI container-config missing HTTPS_PROXY or CA cert for Silas agent' };
      }
      // The gateway returns proxy URLs using the container-only hostname; substitute the
      // real gateway host (same one ONECLI_URL already points at) to reach it from the host.
      const gatewayHost = new URL(ONECLI_URL).hostname;
      const proxy = proxyRaw.replace('host.docker.internal', gatewayHost);
      const caPath = path.join(os.tmpdir(), `post-upgrade-onecli-ca-${crypto.randomUUID()}.pem`);
      fs.writeFileSync(caPath, caCert, { mode: 0o600 });
      try {
        const r = runCommand('git ls-remote https://github.com/zenmindhacker/family.git HEAD', {
          timeoutMs: 20_000,
          env: {
            HTTPS_PROXY: proxy,
            GIT_SSL_CAINFO: caPath,
            GIT_HTTP_PROXY_AUTHMETHOD: 'basic',
            GIT_TERMINAL_PROMPT: '0',
          },
        });
        if (!r.ok || !r.stdout) {
          return {
            status: 'fail',
            message:
              'git ls-remote through the OneCLI gateway failed — check the "GitHub HTTPS" secret\'s auth scheme (git-over-HTTPS requires Basic, not Bearer)',
            detail: redactProxyAuth(r.stderr).slice(0, 300),
          };
        }
        return { status: 'pass', message: 'git ls-remote through OneCLI gateway succeeded' };
      } finally {
        fs.rmSync(caPath, { force: true });
      }
    }),
  );

  checks.push(
    syncTimedCheck('host.coaching-repo', 1, () => {
      const coaching = path.join(home, 'repos', 'coaching');
      if (!fs.existsSync(coaching)) {
        return { status: 'fail', message: 'Missing ~/repos/coaching clone', detail: coaching };
      }
      return { status: 'pass', message: coaching };
    }),
  );

  checks.push(
    syncTimedCheck('host.cycle-canonical-session', 1, () => {
      const r = runCommand(
        `pnpm exec tsx scripts/audit-scheduled-tasks.ts 2>&1 | grep "cycle-daily-briefing.*pending" | grep "${CANONICAL_CYCLE_SESSION}"`,
        { timeoutMs: 30_000, cwd: process.cwd() },
      );
      if (!r.stdout.trim()) {
        return {
          status: 'fail',
          message: `No pending cycle-daily-briefing on canonical session ${CANONICAL_CYCLE_SESSION}`,
          detail: r.stderr || 'grep returned empty',
        };
      }
      if (!r.stdout.includes('0 11 * * *') && !r.stdout.includes('11:00')) {
        return { status: 'fail', message: 'Canonical cycle task not at 11:00 UTC', detail: r.stdout.slice(0, 300) };
      }
      return { status: 'pass', message: r.stdout.trim().slice(0, 120) };
    }),
  );

  checks.push(
    syncTimedCheck('host.cycle-no-0600-pending', 1, () => {
      const r = runCommand(
        'pnpm exec tsx scripts/audit-scheduled-tasks.ts 2>&1 | grep -E "cycle-daily-briefing.*pending.*06:00|pending.*0 6 \\* \\* \\*"',
        { timeoutMs: 30_000, cwd: process.cwd() },
      );
      if (r.stdout.trim()) {
        return {
          status: 'fail',
          message: 'Duplicate cycle briefing still scheduled at 06:00 UTC',
          detail: r.stdout.slice(0, 400),
        };
      }
      return { status: 'pass', message: 'No pending 06:00 cycle-daily-briefing tasks' };
    }),
  );

  checks.push(
    syncTimedCheck('host.torrentday-health-json', 1, () => {
      const script = path.join(process.cwd(), 'skills/torrentday/scripts/torrentday.sh');
      if (!fs.existsSync(script)) {
        return { status: 'fail', message: 'torrentday.sh missing', detail: script };
      }
      const r = runCommand(`${script} health --json`, { timeoutMs: 120_000, cwd: process.cwd() });
      try {
        const parsed = JSON.parse(r.stdout.trim()) as {
          recommendation?: string;
          tjson?: { ok?: boolean };
          browser?: { ok?: boolean; error?: string };
        };
        if (!parsed.recommendation) {
          return { status: 'fail', message: 'torrentday health JSON missing recommendation field', detail: r.stdout.slice(0, 300) };
        }
        if (parsed.recommendation === 'ok') {
          return { status: 'pass', message: 'torrentday health ok' };
        }
        const browserError = String(parsed.browser?.error || r.stderr);
        const missingCreds = /Missing torrentday credentials|stagehand credentials|captcha-solver credentials/i.test(browserError);
        const turnstileBlocked = /Turnstile|manual re-auth|required/i.test(browserError);
        return {
          status: 'warn',
          message: `torrentday needs attention: ${parsed.recommendation}`,
          detail: missingCreds
            ? 'Missing torrentday, stagehand, or captcha-solver credentials on host'
            : turnstileBlocked
              ? 'TorrentDay login still needs a Turnstile solve or manual re-auth'
              : r.stdout.slice(0, 300),
        };
      } catch {
        return { status: 'fail', message: 'torrentday health --json returned invalid JSON', detail: r.stderr || r.stdout };
      }
    }),
  );

  checks.push(
    syncTimedCheck('composition.silas-no-legacy-groups', 1, () => {
      const present = LEGACY_SILAS_GROUPS.filter((folder) =>
        fs.existsSync(path.join(GROUPS_DIR, folder)),
      );
      if (present.length > 0) {
        return {
          status: 'fail',
          message: 'Legacy Silas group folders still on disk',
          detail: present.join(', '),
        };
      }
      return { status: 'pass', message: 'No legacy Silas group folders' };
    }),
  );

  checks.push(
    syncTimedCheck('composition.silas-family-repo-docs', 1, () => {
      const global = path.join(GROUPS_DIR, 'global', 'CLAUDE.md');
      if (!fs.existsSync(global)) {
        return { status: 'warn', message: 'Silas global CLAUDE.md missing' };
      }
      const content = fs.readFileSync(global, 'utf8');
      if (!content.includes('/workspace/extra/repos/family')) {
        return { status: 'fail', message: 'Silas global CLAUDE.md missing family repo path' };
      }
      if (/(?:repos\/lane-family-ops|\/lane-family-ops(?:\/|$))/.test(content)) {
        return { status: 'fail', message: 'Silas global CLAUDE.md still uses lane-family-ops as an active path' };
      }
      return { status: 'pass' };
    }),
  );

  return checks;
}
