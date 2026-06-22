import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';

import { getRegistryEntry } from './registry.mjs';

function resolveCredPath(filename) {
  const servicesPath = `/workspace/extra/credentials/services/${filename}`;
  if (existsSync(servicesPath)) return servicesPath;
  const containerPath = `/workspace/extra/credentials/${filename}`;
  if (existsSync(containerPath)) return containerPath;
  return resolve(homedir(), '.config/nanoclaw/credentials/services', filename);
}

/**
 * Resolve registry id → absolute token/client paths (host or container).
 */
export function resolveGoogleCreds(registryId) {
  const entry = getRegistryEntry(registryId);
  const tokenPath = resolveCredPath(entry.tokenFile);
  const clientPath = resolveCredPath(entry.clientFile);
  if (!existsSync(tokenPath)) {
    throw new Error(
      `Token file missing for ${registryId}: ${tokenPath}. Run host OAuth auth and ncl oauth-refresh-one --id ${entry.id}.`,
    );
  }
  if (!existsSync(clientPath)) {
    throw new Error(`OAuth client file missing for ${registryId}: ${clientPath}`);
  }
  return {
    ...entry,
    tokenPath,
    clientPath,
  };
}

export function readTokenFile(registryId) {
  const { tokenPath } = resolveGoogleCreds(registryId);
  return JSON.parse(readFileSync(tokenPath, 'utf8'));
}

export function readClientFile(registryId) {
  const { clientPath } = resolveGoogleCreds(registryId);
  const raw = JSON.parse(readFileSync(clientPath, 'utf8'));
  return raw.installed ?? raw.web ?? raw;
}
