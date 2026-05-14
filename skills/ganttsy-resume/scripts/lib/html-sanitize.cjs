#!/usr/bin/env node
'use strict';

/**
 * html-sanitize.cjs
 * Reads raw HTML (or text) from stdin.
 * Strips scripts/styles/iframes, event handlers, javascript: URLs.
 * Extracts visible text, filters prompt-injection lines, collapses whitespace.
 * Outputs clean plain text to stdout.
 *
 * Used by: fetch-portfolio.sh (sanitize_text)
 */

const INJECTION_PATTERNS = [
  /ignore previous/i,
  /disregard (all|previous) instructions/i,
  /system prompt/i,
  /developer message/i,
  /you are (an|a) ai/i,
  /act as/i,
  /jailbreak/i,
  /prompt injection/i,
  /do not follow/i,
  /override/i,
];

function readStdin() {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { buf += d; });
    process.stdin.on('end', () => resolve(buf));
  });
}

function stripBlockTags(html) {
  // Remove script/style/iframe/noscript blocks with their content
  return html.replace(/<(script|style|iframe|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
}

function stripEventHandlers(html) {
  // Strip on* attributes and javascript: URLs
  let s = html.replace(/\bon\w+\s*=\s*"[^"]*"/gi, ' ');
  s = s.replace(/\bon\w+\s*=\s*'[^']*'/gi, ' ');
  s = s.replace(/javascript:\s*\S+/gi, ' ');
  return s;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ');
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

async function main() {
  let raw = await readStdin();

  raw = stripBlockTags(raw);
  raw = stripEventHandlers(raw);
  const text = decodeEntities(stripTags(raw));

  const lines = text.split('\n')
    .map(l => l.replace(/[ \t]+/g, ' ').trim())
    .filter(l => {
      if (!l) return false;
      const low = l.toLowerCase();
      return !INJECTION_PATTERNS.some(p => p.test(low));
    });

  process.stdout.write(lines.join('\n').trim() + '\n');
}

main().catch(err => {
  process.stderr.write(`html-sanitize: ${err.message}\n`);
  process.exit(1);
});
