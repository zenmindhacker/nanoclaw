/**
 * Secrets management — dual-source credential loading.
 *
 * Credentials come from two sources, merged at container spawn time:
 *
 * 1. **Manifest + process.env** — keys listed in data/secrets-manifest.json,
 *    values from process.env (set via .env / systemd EnvironmentFile).
 *    Managed by the host admin.
 *
 * 2. **Credential files** — agents write JSON files to the credentials
 *    directory (~/.config/nanoclaw/credentials/services/). A registry file
 *    (credentials.json) maps env var names to values. Agents have full
 *    lifecycle control: add, update, remove.
 *
 * File-based credentials take precedence over manifest-based ones,
 * so agents can override host-level defaults.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { loadMountAllowlist } from './mount-security.js';

export const MANIFEST_PATH = path.join(DATA_DIR, 'secrets-manifest.json');

// The credential registry filename agents write to
const CREDENTIAL_REGISTRY_FILE = 'credentials.json';

interface SecretEntry {
  name: string;
  description: string;
  env_var: string;
  groups: string[];
  type: 'static' | 'file';
  file_path?: string;
}

interface SecretsManifest {
  version: number;
  secrets: SecretEntry[];
}

/**
 * Read the secrets manifest (metadata only — no secret values).
 * Returns null if the manifest doesn't exist.
 */
export function loadManifest(): SecretsManifest | null {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the host-side credentials directory path.
 * Reads mount-allowlist.json to find the "credentials" default mount.
 */
function resolveCredentialsDir(): string | null {
  try {
    const allowlist = loadMountAllowlist();
    if (!allowlist?.defaultMounts) return null;

    const credMount = allowlist.defaultMounts.find(
      (dm) => dm.containerName === 'credentials',
    );
    if (!credMount) return null;

    const mountPath = credMount.path.startsWith('~')
      ? path.join(os.homedir(), credMount.path.slice(1))
      : credMount.path;

    return fs.existsSync(mountPath) ? mountPath : null;
  } catch {
    return null;
  }
}

/**
 * Read agent-managed credential registry from the credentials directory.
 * Returns env var → value pairs from credentials.json.
 */
function readCredentialRegistry(): Record<string, string> {
  const credDir = resolveCredentialsDir();
  if (!credDir) return {};

  const registryPath = path.join(credDir, CREDENTIAL_REGISTRY_FILE);
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Validate: must be a flat object of string → string
    if (typeof parsed !== 'object' || parsed === null) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.length > 0) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    // File doesn't exist or invalid JSON — fine, no agent-managed creds
    return {};
  }
}

/**
 * Return all secrets for a given group as { ENV_VAR: value } pairs.
 *
 * Merges two sources:
 * 1. Manifest entries matched to this group, values from process.env
 * 2. Agent-managed credentials.json (takes precedence)
 */
export function getSecretsForGroup(
  groupFolder: string,
  inheritFromFolder?: string,
): {
  env: Record<string, string>;
  missing: string[];
} {
  const env: Record<string, string> = {};
  const missing: string[] = [];

  // Source 1: manifest-based secrets from process.env.
  // Thread groups inherit their parent's secret allowlist via
  // inheritFromFolder so they get the same env as the parent group's
  // containers.
  const manifest = loadManifest();
  if (manifest) {
    for (const entry of manifest.secrets) {
      if (entry.type === 'file') continue;

      const applies =
        entry.groups.includes('*') ||
        entry.groups.includes(groupFolder) ||
        (inheritFromFolder !== undefined &&
          entry.groups.includes(inheritFromFolder));
      if (!applies) continue;

      const value = process.env[entry.env_var];
      if (value) {
        env[entry.env_var] = value;
      } else {
        missing.push(entry.name);
      }
    }
  }

  // Source 2: agent-managed credential registry (overrides manifest)
  const agentCreds = readCredentialRegistry();
  for (const [key, value] of Object.entries(agentCreds)) {
    env[key] = value;
    // If this key was in the missing list, remove it — agent provided it
    const idx = missing.indexOf(key);
    if (idx !== -1) missing.splice(idx, 1);
  }

  if (missing.length > 0) {
    logger.warn(
      { groupFolder, missing },
      'Some secrets not found — check .env or credentials.json',
    );
  }

  return { env, missing };
}
