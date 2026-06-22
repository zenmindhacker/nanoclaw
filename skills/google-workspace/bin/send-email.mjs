#!/usr/bin/env node
/**
 * Send email via Gmail API using host-managed OAuth (read-only token).
 *
 * Usage:
 *   node send-email.mjs --registry shadow-google --to user@example.com --subject "Hi" --body "..."
 */
import https from 'https';

import { getAccessToken } from '../lib/access-token.mjs';

function parseArgs(argv) {
  const out = { registry: 'shadow-google' };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--registry') out.registry = val;
    if (key === '--to') out.to = val;
    if (key === '--subject') out.subject = val;
    if (key === '--body') out.body = val;
    if (key.startsWith('--')) i++;
  }
  return out;
}

function buildRawEmail({ to, subject, body }) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function gmailSend(accessToken, raw) {
  const payload = JSON.stringify({ raw });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'gmail.googleapis.com',
        path: '/gmail/v1/users/me/messages/send',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const args = parseArgs(process.argv);
if (!args.to || !args.subject || !args.body) {
  console.error('Usage: send-email.mjs --to ADDR --subject TEXT --body TEXT [--registry shadow-google]');
  process.exit(1);
}

const accessToken = getAccessToken(args.registry);
const raw = buildRawEmail(args);
const result = await gmailSend(accessToken, raw);
if (result.error) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ id: result.id, threadId: result.threadId }, null, 2));
