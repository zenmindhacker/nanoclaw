export type AgentName = 'cleo' | 'silas';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type CheckTier = 1 | 2;

export interface CheckResult {
  id: string;
  tier: CheckTier;
  status: CheckStatus;
  ms: number;
  message?: string;
  detail?: string;
}

export interface UpgradeReport {
  agent: AgentName;
  commit: string;
  tiers: string[];
  startedAt: string;
  finishedAt: string;
  checks: CheckResult[];
  summary: { pass: number; fail: number; warn: number; skip: number };
}

export interface AgentManifest {
  agent: AgentName;
  primaryGroupFolder: string;
  /** Substrings expected in wiki/index.md Categories section (Tier 2 wiki prompt). */
  wikiCategoryHints: string[];
  /** Read-only skill smoke commands run inside container or on host. */
  skillCommands: Array<{ id: string; cmd: string; cwd?: string }>;
  /** Cleo-only host checks. */
  cleoOnly?: boolean;
  /** Silas-only host checks. */
  silasOnly?: boolean;
}

export interface RunContext {
  agent: AgentName;
  manifest: AgentManifest;
  agentGroupId: string;
  agentGroupFolder: string;
  primarySessionId: string | null;
  containerName: string | null;
  /** Date stamp for reports (human-readable). */
  upgradeTestTag: string;
}
