/**
 * Secrets management — macOS Keychain integration.
 *
 * All non-Slack credentials live in Keychain under service "nanoclaw-secrets".
 * The manifest at data/secrets-manifest.json lists what's stored (no values).
 * Agents receive secrets as injected env vars — they never touch Keychain directly.
 *
 * Slack tokens stay in .env — they are the comms channel and must survive a Keychain lock.
 */

import { execFileSync } from 'child_process';
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
  /** static/oauth: stored in Keychain, injected as env var. file: credential file, mounted into containers. */
  type: 'static' | 'oauth' | 'file';
  /** For type=file: absolute path to the credential file (~ expanded). */
  file_path?: string;
}

interface SecretsManifest {
  version: number;
  keychain_service: string;
  secrets: SecretEntry[];
}

// In-memory cache to avoid repeated Keychain reads within one process lifetime.
const cache = new Map<string, string>();

/** Read the secrets manifest (no values — metadata only). */
export function loadManifest(): SecretsManifest {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
  return JSON.parse(raw) as SecretsManifest;
}

/**
 * Read a single secret from Keychain by name.
 * Returns null if not found or Keychain is locked.
 */
export function getSecret(name: string): string | null {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  try {
    const value = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name, '-w'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
    if (value) {
      cache.set(name, value);
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write a secret to Keychain.
 * Replaces existing item if present.
 * Uses -T /usr/bin/security so the CLI can read it back without prompts.
 */
export function setSecret(name: string, value: string): void {
  // Delete existing item silently
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name],
      { stdio: 'ignore' },
    );
  } catch {
    // Not found — fine
  }

  execFileSync('security', [
    'add-generic-password',
    '-s',
    KEYCHAIN_SERVICE,
    '-a',
    name,
    '-w',
    value,
    '-T',
    '/usr/bin/security',
  ]);
  cache.set(name, value);
}

/** Remove a secret from Keychain. */
export function deleteSecret(name: string): void {
  try {
    execFileSync(
      'security',
      ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name],
      { stdio: 'ignore' },
    );
  } catch {
    // Not found — fine
  }
  cache.delete(name);
}

/**
 * Return all secrets for a given group as { ENV_VAR: value } pairs.
 * Secrets missing from Keychain are omitted (with a warning).
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

    const value = getSecret(entry.name);
    if (value) {
      env[entry.env_var] = value;
    } else {
      missing.push(entry.name);
    }
  }

  if (missing.length > 0) {
    logger.warn(
      { groupFolder, missing },
      'Some secrets not found in Keychain — Keychain may be locked or secrets not yet stored',
    );
  }

  return { env, missing };
}

/**
 * Return a list of all secrets with their Keychain status.
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
    stored: getSecret(entry.name) !== null,
  }));
}
