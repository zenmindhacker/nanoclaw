#!/usr/bin/env node
/**
 * Print shell exports for gws CLI (token + merged credentials file in /tmp).
 */
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getAccessToken } from './access-token.mjs';
import { normalizeOAuthTokenShape, tokenExpiresAt } from './normalize-token.mjs';
import { readClientFile, readTokenFile } from './resolve-google-creds.mjs';

const registryId = process.argv[2];
if (!registryId) {
  console.error('Usage: build-gws-env.mjs <registry-id>');
  process.exit(1);
}

try {
  const accessToken = getAccessToken(registryId);
  const client = readClientFile(registryId);
  const token = normalizeOAuthTokenShape(readTokenFile(registryId));
  const expiresAt = tokenExpiresAt(token);
  const dir = mkdtempSync(join(tmpdir(), `gws-${registryId}-`));
  const credPath = join(dir, 'credentials.json');
  const payload = {
    type: 'authorized_user',
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    access_token: accessToken,
    ...(expiresAt ? { expiry_date: expiresAt * 1000 } : {}),
  };
  writeFileSync(credPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `export GOOGLE_WORKSPACE_CLI_TOKEN=${shellQuote(accessToken)}\n` +
      `export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE=${shellQuote(credPath)}\n`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
