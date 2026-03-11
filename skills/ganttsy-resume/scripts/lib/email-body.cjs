#!/usr/bin/env node
'use strict';

/**
 * email-body.cjs
 * Reads a Gmail API message JSON and outputs decoded body content.
 *
 * Modes:
 *   --urls           Read JSON from stdin; print discovered URLs, one per line.
 *   --body <file>    Read JSON from <file>; print decoded plain text / HTML body.
 *
 * Used by:
 *   fetch-portfolio.sh  (--urls, via stdin pipe)
 *   fetch-resumes.sh    (--body, via temp file)
 */

const fs = require('fs');

const mode = process.argv[2];

function walkParts(part, texts) {
  if (!part || typeof part !== 'object') return;
  const mime = part.mimeType || '';
  const body = part.body || {};
  const b64  = body.data;
  if (b64 && (mime === 'text/plain' || mime === 'text/html')) {
    try {
      const fixed = b64.replace(/-/g, '+').replace(/_/g, '/');
      const pad   = '='.repeat((-fixed.length % 4 + 4) % 4);
      texts.push(Buffer.from(fixed + pad, 'base64').toString('utf8'));
    } catch {
      // ignore decode errors
    }
  }
  for (const p of part.parts || []) walkParts(p, texts);
}

function readStdin() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { buf += d; });
    process.stdin.on('end', () => resolve(buf));
  });
}

async function main() {
  if (mode === '--urls') {
    const raw  = await readStdin();
    const data = JSON.parse(raw);
    const texts = [];
    walkParts(data.payload || {}, texts);
    const blob = texts.join('\n');

    const urlRe = /https?:\/\/[^\s)<>"']+|www\.[^\s)<>"']+/g;
    const seen  = new Set();
    const clean = [];
    for (const m of blob.matchAll(urlRe)) {
      const u = m[0].replace(/[.,;:)\]"]+$/, '');
      if (!seen.has(u)) { seen.add(u); clean.push(u); }
    }
    process.stdout.write(clean.join('\n') + (clean.length ? '\n' : ''));

  } else if (mode === '--body') {
    const filePath = process.argv[3];
    if (!filePath) {
      process.stderr.write('Usage: email-body.cjs --body <file>\n');
      process.exit(1);
    }
    const data  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const texts = [];
    walkParts(data.payload || {}, texts);
    process.stdout.write(texts.join('\n---\n'));

  } else {
    process.stderr.write('Usage: email-body.cjs --urls | --body <file>\n');
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`email-body: ${err.message}\n`);
  process.exit(1);
});
