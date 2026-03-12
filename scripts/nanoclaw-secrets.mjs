#!/usr/bin/env node
/**
 * nanoclaw-secrets — CLI for managing NanoClaw credentials in macOS Keychain.
 *
 * Usage:
 *   nanoclaw-secrets list              List all secrets and their status
 *   nanoclaw-secrets set <name>        Store a secret (prompts for value)
 *   nanoclaw-secrets set <name> -      Read value from stdin
 *   nanoclaw-secrets get <name>        Print a secret value (careful!)
 *   nanoclaw-secrets delete <name>     Remove a secret from Keychain
 *   nanoclaw-secrets migrate           Migrate values from .env to Keychain
 *   nanoclaw-secrets status            Check which secrets are missing
 *
 * All secrets live under Keychain service: nanoclaw-secrets
 * Find them in Keychain Access by filtering Service = "nanoclaw-secrets"
 */

import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'data', 'secrets-manifest.json');
const ENV_PATH = path.join(PROJECT_ROOT, 'data', 'env', 'env');
const KEYCHAIN_SERVICE = 'nanoclaw-secrets';
const OC_CREDS_DIR = path.join(process.env.HOME, '.openclaw', 'credentials');
const NC_CREDS_DIR = path.join(process.env.HOME, '.config', 'nanoclaw', 'credentials');

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
}

function getSecret(name) {
  try {
    return execFileSync('security', [
      'find-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', name,
      '-w',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || null;
  } catch {
    return null;
  }
}

function setSecret(name, value) {
  // Delete existing silently
  try {
    execFileSync('security', [
      'delete-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', name,
    ], { stdio: 'ignore' });
  } catch { /* not found */ }

  execFileSync('security', [
    'add-generic-password',
    '-s', KEYCHAIN_SERVICE,
    '-a', name,
    '-w', value,
    '-T', '/usr/bin/security',  // pre-authorize CLI for non-interactive reads
  ]);
}

function deleteSecret(name) {
  try {
    execFileSync('security', [
      'delete-generic-password',
      '-s', KEYCHAIN_SERVICE,
      '-a', name,
    ]);
    return true;
  } catch {
    return false;
  }
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

function promptSecret(question) {
  return new Promise((resolve) => {
    process.stderr.write(question);
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    const chunks = [];
    process.stdin.setRawMode?.(true);
    process.stdin.on('data', (ch) => {
      ch = ch.toString();
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        process.stdin.setRawMode?.(false);
        process.stderr.write('\n');
        rl.close();
        resolve(chunks.join(''));
      } else if (ch === '\u0003') {
        process.exit(1);
      } else {
        chunks.push(ch);
        process.stderr.write('*');
      }
    });
  });
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', d => chunks.push(d));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString().trim()));
  });
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const line of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return result;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdList() {
  const manifest = loadManifest();
  console.log(`\nKeychain service: ${KEYCHAIN_SERVICE}\n`);
  console.log('NAME                          ENV VAR                        STORED  GROUPS');
  console.log('─'.repeat(90));
  for (const s of manifest.secrets) {
    const stored = getSecret(s.name) !== null;
    const name = s.name.padEnd(30);
    const envVar = s.env_var.padEnd(30);
    const status = stored ? '✓ yes ' : '✗ no  ';
    const groups = s.groups.join(', ');
    console.log(`${name}  ${envVar}  ${status}  ${groups}`);
  }
  console.log();
}

async function cmdSet(name, fromStdin) {
  if (!name) { console.error('Usage: nanoclaw-secrets set <name>'); process.exit(1); }

  let value;
  if (fromStdin) {
    value = await readStdin();
  } else {
    value = await promptSecret(`Value for "${name}": `);
  }

  if (!value) { console.error('No value provided.'); process.exit(1); }

  setSecret(name, value);

  // Check if this name is in the manifest; warn if not
  const manifest = loadManifest();
  const known = manifest.secrets.find(s => s.name === name);
  if (!known) {
    console.error(`\nWarning: "${name}" is not in secrets-manifest.json.`);
    console.error('Add an entry to data/secrets-manifest.json so agents know this credential exists.\n');
  }

  console.log(`✓ Stored "${name}" in Keychain (service: ${KEYCHAIN_SERVICE})`);
}

function cmdGet(name) {
  if (!name) { console.error('Usage: nanoclaw-secrets get <name>'); process.exit(1); }
  const value = getSecret(name);
  if (!value) { console.error(`Not found: "${name}"`); process.exit(1); }
  process.stdout.write(value + '\n');
}

function cmdDelete(name) {
  if (!name) { console.error('Usage: nanoclaw-secrets delete <name>'); process.exit(1); }
  if (deleteSecret(name)) {
    console.log(`✓ Deleted "${name}" from Keychain`);
  } else {
    console.error(`Not found: "${name}"`);
    process.exit(1);
  }
}

async function cmdMigrate() {
  const manifest = loadManifest();
  const env = parseEnvFile(ENV_PATH);

  // Build a map from env_var → secret name for manifest entries
  const envVarToSecret = {};
  for (const s of manifest.secrets) {
    envVarToSecret[s.env_var] = s.name;
  }

  console.log('\nMigrating secrets from .env to Keychain...\n');

  let migrated = 0;
  let skipped = 0;

  for (const [envVar, secretName] of Object.entries(envVarToSecret)) {
    const value = env[envVar];
    if (!value) {
      console.log(`  skip  ${envVar} (not in .env)`);
      skipped++;
      continue;
    }

    const existing = getSecret(secretName);
    if (existing) {
      console.log(`  skip  ${envVar} (already in Keychain as "${secretName}")`);
      skipped++;
      continue;
    }

    setSecret(secretName, value);
    console.log(`  ✓     ${envVar} → Keychain "${secretName}"`);
    migrated++;
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped.`);
  if (migrated > 0) {
    console.log('\nNext: remove migrated keys from .env (keep SLACK_* and non-secret config).');
  }
}

function cmdStatus() {
  const manifest = loadManifest();
  const keychainSecrets = manifest.secrets.filter(s => s.type !== 'file');
  const fileSecrets = manifest.secrets.filter(s => s.type === 'file');

  const missing = keychainSecrets.filter(s => getSecret(s.name) === null);
  if (missing.length === 0) {
    console.log('✓ All Keychain secrets are stored.');
  } else {
    console.log(`\n✗ Missing from Keychain (${missing.length}):\n`);
    for (const s of missing) {
      console.log(`  ${s.name.padEnd(35)}  ${s.description}`);
    }
    console.log('\nRun: npm run secrets set <name>  to add each one.\n');
  }

  if (fileSecrets.length > 0) {
    console.log(`\nFile-based credentials (${fileSecrets.length}) — check paths exist:`);
    for (const s of fileSecrets) {
      const expanded = s.file_path.replace('~', process.env.HOME);
      const exists = fs.existsSync(expanded);
      console.log(`  ${exists ? '✓' : '✗'} ${s.name.padEnd(40)} ${s.file_path}`);
    }
    console.log();
  }
}

async function cmdMigrateFromOC() {
  const manifest = loadManifest();
  console.log('\nMigrating credentials from OpenClaw to NanoClaw...\n');

  // Map: OC filename → manifest secret name
  const ocToManifest = {
    '11labs':                    '11labs',
    'attio':                     'attio',
    'beeper':                    'beeper',
    'browserless':               'browserless',
    'deepseek':                  'deepseek',
    'fathom-api-key':            'fathom.api_key',
    'fathom-webhook-secret':     'fathom.webhook_secret',
    'instagram-app-id':          'instagram.app_id',
    'instagram-app-secret':      'instagram.app_secret',
    'kimi':                      'kimi',
    'minimax':                   'minimax',
    'openai':                    'openai.api_key',
    'openrouter':                'openrouter',
    'substack-username':         'substack.username',
    'substack-password':         'substack.password',
    'toggl':                     'toggl',
    'xero-client-id':            'xero.client_id',
    'xero-client-secret':        'xero.client_secret',
  };

  // File credentials: copy to ~/.config/nanoclaw/credentials/
  const ocFileMap = {
    'xero-tokens.json':                 'xero-tokens.json',
    'ganttsy-google-token.json':        'ganttsy-google-token.json',
    'ganttsy-google-oauth-client.json': 'ganttsy-google-oauth-client.json',
  };

  if (!fs.existsSync(OC_CREDS_DIR)) {
    console.error(`OpenClaw credentials directory not found: ${OC_CREDS_DIR}`);
    process.exit(1);
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  // Migrate Keychain secrets
  for (const [ocFile, secretName] of Object.entries(ocToManifest)) {
    const ocPath = path.join(OC_CREDS_DIR, ocFile);
    if (!fs.existsSync(ocPath)) {
      console.log(`  skip  ${ocFile} (not in OC credentials)`);
      skipped++;
      continue;
    }

    const existing = getSecret(secretName);
    if (existing) {
      console.log(`  skip  ${ocFile} (already in Keychain as "${secretName}")`);
      skipped++;
      continue;
    }

    try {
      const value = fs.readFileSync(ocPath, 'utf-8').trim();
      if (!value) {
        console.log(`  skip  ${ocFile} (empty file)`);
        skipped++;
        continue;
      }
      setSecret(secretName, value);
      console.log(`  ✓     ${ocFile} → Keychain "${secretName}"`);
      migrated++;
    } catch (err) {
      console.error(`  ✗     ${ocFile}: ${err.message}`);
      failed++;
    }
  }

  // Copy file credentials
  if (Object.keys(ocFileMap).length > 0) {
    console.log('\nCopying file-based credentials...\n');
    fs.mkdirSync(NC_CREDS_DIR, { recursive: true });

    for (const [ocFile, ncFile] of Object.entries(ocFileMap)) {
      const ocPath = path.join(OC_CREDS_DIR, ocFile);
      const ncPath = path.join(NC_CREDS_DIR, ncFile);

      if (!fs.existsSync(ocPath)) {
        console.log(`  skip  ${ocFile} (not in OC credentials)`);
        skipped++;
        continue;
      }
      if (fs.existsSync(ncPath)) {
        console.log(`  skip  ${ncFile} (already exists at ${ncPath})`);
        skipped++;
        continue;
      }
      try {
        fs.copyFileSync(ocPath, ncPath);
        console.log(`  ✓     ${ocFile} → ${ncPath}`);
        migrated++;
      } catch (err) {
        console.error(`  ✗     ${ocFile}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\nDone: ${migrated} migrated, ${skipped} skipped, ${failed} failed.`);

  // Also migrate Linear keys from .env if they're there
  const env = parseEnvFile(ENV_PATH);
  const envLinearMap = {
    'LINEAR_API_KEY_COGNITIVE': 'linear.cognitive',
    'LINEAR_API_KEY_CT':        'linear.ct',
    'LINEAR_API_KEY_GANTTSY':   'linear.ganttsy',
    'OPENAI_API_KEY':           'openai.api_key',
  };
  let envMigrated = 0;
  for (const [envVar, secretName] of Object.entries(envLinearMap)) {
    const value = env[envVar];
    if (!value) continue;
    if (getSecret(secretName)) continue;
    setSecret(secretName, value);
    console.log(`  ✓     .env:${envVar} → Keychain "${secretName}"`);
    envMigrated++;
  }
  if (envMigrated > 0) {
    console.log(`\nAlso migrated ${envMigrated} keys from .env.`);
    console.log('You can now remove LINEAR_API_KEY_* and OPENAI_API_KEY from .env.\n');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const [,, cmd, arg] = process.argv;

switch (cmd) {
  case 'list':             cmdList(); break;
  case 'set':              await cmdSet(arg, process.argv[4] === '-'); break;
  case 'get':              cmdGet(arg); break;
  case 'delete':           cmdDelete(arg); break;
  case 'migrate':          await cmdMigrate(); break;
  case 'migrate-from-oc':  await cmdMigrateFromOC(); break;
  case 'status':           cmdStatus(); break;
  default:
    console.log(`
nanoclaw-secrets — manage NanoClaw credentials in macOS Keychain

Commands:
  list              Show all secrets and whether they are stored
  set <name>        Store a secret interactively (prompts for value)
  set <name> -      Read value from stdin (for scripting)
  get <name>        Print secret value to stdout
  delete <name>     Remove a secret from Keychain
  migrate           Copy matching values from .env into Keychain
  migrate-from-oc   One-time: migrate all credentials from ~/.openclaw/credentials/
  status            Check which secrets are missing

Keychain service: ${KEYCHAIN_SERVICE}
Find items in Keychain Access by filtering Service = "${KEYCHAIN_SERVICE}"
`);
}
