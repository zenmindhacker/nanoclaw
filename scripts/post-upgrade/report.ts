import type { CheckResult, UpgradeReport } from './types.js';

export function summarizeChecks(checks: CheckResult[]): UpgradeReport['summary'] {
  return checks.reduce(
    (acc, c) => {
      acc[c.status]++;
      return acc;
    },
    { pass: 0, fail: 0, warn: 0, skip: 0 },
  );
}

export function buildReport(partial: Omit<UpgradeReport, 'summary' | 'finishedAt'>): UpgradeReport {
  const finishedAt = new Date().toISOString();
  return {
    ...partial,
    finishedAt,
    summary: summarizeChecks(partial.checks),
  };
}

export function printReport(report: UpgradeReport): void {
  console.log(JSON.stringify(report, null, 2));
}

export function hasTierFailures(checks: CheckResult[], tier: 1 | 2): boolean {
  return checks.some((c) => c.tier === tier && c.status === 'fail');
}

export async function timedCheck(
  id: string,
  tier: 1 | 2,
  fn: () => Promise<Omit<CheckResult, 'id' | 'tier' | 'ms'>>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { id, tier, ms: Date.now() - start, ...result };
  } catch (err) {
    return {
      id,
      tier,
      ms: Date.now() - start,
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function syncTimedCheck(
  id: string,
  tier: 1 | 2,
  fn: () => Omit<CheckResult, 'id' | 'tier' | 'ms'>,
): CheckResult {
  const start = Date.now();
  try {
    const result = fn();
    return { id, tier, ms: Date.now() - start, ...result };
  } catch (err) {
    return {
      id,
      tier,
      ms: Date.now() - start,
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
