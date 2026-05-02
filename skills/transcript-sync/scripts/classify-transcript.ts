#!/usr/bin/env node
/**
 * classify-transcript — record a manual classification for a transcript
 * meeting that the pipeline couldn't auto-route.
 *
 * Triggered when Cian replies `classify shadow=<id> <org>` or `skip shadow=<id>`
 * in #sysops. Writes to `.classifications.json` in the skill dir; the main
 * transcript-sync pipeline reads this file on its next run and applies the
 * override (routes to the specified org's default dir, or adds to the
 * skippedConvs state so the meeting is ignored permanently).
 *
 * Usage:
 *   tsx classify-transcript.ts <source>=<id> <org>
 *   tsx classify-transcript.ts shadow=362 nvs
 *   tsx classify-transcript.ts shadow=310 skip
 *   tsx classify-transcript.ts --list           # show pending overrides
 *   tsx classify-transcript.ts --clear <source>=<id>  # undo an override
 *
 * Valid org values:
 *   ganttsy, ganttsy-strategy, ct, ctci, nvs, personal,
 *   kevin, christina, mondo-zen, testboard,
 *   skip  (marks meeting as permanently skipped)
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CLASSIFICATIONS_PATH =
  process.env.CLASSIFICATIONS_PATH ||
  join(
    process.env.SKILLS_ROOT || '/workspace/extra/skills',
    'transcript-sync',
    '.classifications.json',
  );

// Matches the org slugs the pipeline understands. Keep in sync with the
// switch in transcript-sync.ts's processMeeting override branch.
const VALID_ORGS = new Set([
  'skip',
  'ganttsy',         // → ganttsy/ganttsy-docs/transcripts
  'ganttsy-strategy',// → ganttsy/ganttsy-strategy/transcripts
  'ct',              // → copperteams/ct-docs/planning/transcripts
  'ctci',            // → cognitivetech/ctci-docs/transcripts
  'nvs',             // → nvs/nvs-docs/transcripts
  'personal',        // → personal/transcripts
  'kevin',           // → cognitivetech/coaching/kevin/transcripts
  'christina',       // → cognitivetech/coaching/christina/transcripts
  'mondo-zen',       // → cognitivetech/coaching/mondo-zen/transcripts
  'testboard',       // → cognitivetech/ctci-docs/transcripts/testboard
]);

interface ClassificationsFile {
  overrides: Record<string, string>; // key = "<source>=<id>", value = org slug or "skip"
  updatedAt: string;
}

function loadFile(): ClassificationsFile {
  if (!existsSync(CLASSIFICATIONS_PATH)) {
    return { overrides: {}, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = JSON.parse(readFileSync(CLASSIFICATIONS_PATH, 'utf-8'));
    return { overrides: raw.overrides || {}, updatedAt: raw.updatedAt || '' };
  } catch (err: any) {
    console.error(`Corrupt classifications file at ${CLASSIFICATIONS_PATH}: ${err.message}`);
    process.exit(2);
  }
}

function saveFile(data: ClassificationsFile): void {
  mkdirSync(dirname(CLASSIFICATIONS_PATH), { recursive: true });
  const tmp = `${CLASSIFICATIONS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, CLASSIFICATIONS_PATH);
}

function die(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const args = process.argv.slice(2);

if (args[0] === '--list') {
  const { overrides, updatedAt } = loadFile();
  const entries = Object.entries(overrides);
  if (entries.length === 0) {
    console.log('no pending classifications');
  } else {
    console.log(`${entries.length} pending classification(s) (updated ${updatedAt}):`);
    for (const [key, org] of entries) console.log(`  ${key} → ${org}`);
  }
  process.exit(0);
}

if (args[0] === '--clear') {
  const key = args[1];
  if (!key) die('usage: classify-transcript.ts --clear <source>=<id>');
  const data = loadFile();
  if (!data.overrides[key]) {
    console.log(`no existing override for ${key}`);
    process.exit(0);
  }
  delete data.overrides[key];
  data.updatedAt = new Date().toISOString();
  saveFile(data);
  console.log(`cleared ${key}`);
  process.exit(0);
}

// Positional: <source>=<id> <org>
const [key, org] = args;
if (!key || !org) {
  die(
    'usage:\n' +
      '  classify-transcript.ts <source>=<id> <org>\n' +
      '  classify-transcript.ts --list\n' +
      '  classify-transcript.ts --clear <source>=<id>\n\n' +
      'valid orgs: ' +
      [...VALID_ORGS].join(', '),
  );
}

// Accept both "shadow=362" and "shadow:362" and just "362" (assume shadow)
let normKey = key.toLowerCase().replace(':', '=');
if (/^\d+$/.test(normKey)) normKey = `shadow=${normKey}`;
if (!/^(shadow|ganttsy_workspace)=\S+$/.test(normKey)) {
  die(`invalid key format "${key}"; expected <source>=<id> (e.g. shadow=362)`);
}

const normOrg = org.toLowerCase();
if (!VALID_ORGS.has(normOrg)) {
  die(`invalid org "${org}"; valid: ${[...VALID_ORGS].join(', ')}`);
}

const data = loadFile();
const existing = data.overrides[normKey];
data.overrides[normKey] = normOrg;
data.updatedAt = new Date().toISOString();
saveFile(data);

if (existing) {
  console.log(`updated ${normKey}: ${existing} → ${normOrg}`);
} else {
  console.log(`recorded ${normKey} → ${normOrg}`);
}
console.log(`pipeline will apply on next run (or run transcript-sync.ts now to force)`);
