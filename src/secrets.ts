/**
 * Secrets management — reads from environment variables.
 *
 * All non-Slack credentials are loaded from process.env (set via .env / systemd).
 * The manifest at data/secrets-manifest.json maps secret names to env var names.
 * Agents receive secrets as injected env vars — they never access the host env directly.
 *
 * Slack tokens stay in .env — they are the comms channel and load at process start.
 */

import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export const KEYCHAIN_SERVICE = 'nanoclaw-secrets';
export const MANIFEST_PATH = path.join(DATA_DIR, 'secrets-manifest.json');

export interface SecretEntry {
  name: string;
  description: string;
  env_var: string;
  /** Group folder names that receive this secret, or ['*'] for all groups. */
  groups: string[];
  /** static/oauth: env var injected into containers. file: credential file, mounted. */
  type: 'static' | 'oauth' | 'file';
  /** For type=file: absolute path to the credential file (~ expanded). */
  file_path?: string;
}

interface SecretsManifest {
  version: number;
  keychain_service: string;
  secrets: SecretEntry[];
}

// Build name→env_var lookup from manifest (loaded once).
let envVarMap: Map<string, string> | null = null;

function getEnvVarMap(): Map<string, string> {
  if (envVarMap) return envVarMap;
  try {
    const manifest = loadManifest();
    envVarMap = new Map(
      manifest.secrets
        .filter((s) => s.type !== 'file')
        .map((s) => [s.name, s.env_var]),
    );
  } catch {
    envVarMap = new Map();
  }
  return envVarMap;
}

/** Read the secrets manifest (no values — metadata only). */
export function loadManifest(): SecretsManifest {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw) as SecretsManifest;
}

/**
 * Read a single secret by name.
 * Looks up the env var name from the manifest, reads from process.env.
 */
export function getSecret(name: string): string | null {
  const map = getEnvVarMap();
  const envVar = map.get(name);
  if (!envVar) return null;
  return process.env[envVar] || null;
}

/**
 * Return all secrets for a given group as { ENV_VAR: value } pairs.
 * Secrets missing from env are omitted (with a warning).
 * Call this at container startup to build the env injection map.
 */
export function getSecretsForGroup(groupFolder: string): {
  env: Record<string, string>;
  missing: string[];
} {
  let manifest: SecretsManifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    logger.warn({ err }, 'Could not load secrets manifest');
    return { env: {}, missing: [] };
  }

  const env: Record<string, string> = {};
  const missing: string[] = [];

  for (const entry of manifest.secrets) {
    // File-type credentials are handled by container mounts, not env injection
    if (entry.type === 'file') continue;

    const applies =
      entry.groups.includes('*') || entry.groups.includes(groupFolder);
    if (!applies) continue;

    const value = process.env[entry.env_var];
    if (value) {
      env[entry.env_var] = value;
    } else {
      missing.push(entry.name);
    }
  }

  if (missing.length > 0) {
    logger.warn(
      { groupFolder, missing },
      'Some secrets not found in environment — check .env file',
    );
  }

  return { env, missing };
}

/**
 * Return a list of all secrets with their availability status.
 * Used by the CLI and for diagnostics.
 */
export function listSecrets(): Array<SecretEntry & { stored: boolean }> {
  let manifest: SecretsManifest;
  try {
    manifest = loadManifest();
  } catch {
    return [];
  }

  return manifest.secrets.map((entry) => ({
    ...entry,
    stored: entry.type === 'file' ? true : !!process.env[entry.env_var],
  }));
}
