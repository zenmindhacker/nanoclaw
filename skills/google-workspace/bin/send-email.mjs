#!/usr/bin/env node
/**
 * Send email via Gmail API using host-managed OAuth (read-only token).
 *
 * Usage:
 *   node send-email.mjs --registry shadow-google --to user@example.com --subject "Hi" --body "..."
 *   node send-email.mjs --to user@example.com --subject "Hi" --body "..." --attach /path/file.pdf
 */
import fs from 'fs';
import https from 'https';
import path from 'path';

import { getAccessToken } from '../lib/access-token.mjs';

function parseArgs(argv) {
  const out = {
    registry: process.env.CT_GOOGLE_REGISTRY || 'shadow-google',
    attach: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--registry') {
      out.registry = val;
      i++;
      continue;
    }
    if (key === '--to') {
      out.to = val;
      i++;
      continue;
    }
    if (key === '--subject') {
      out.subject = val;
      i++;
      continue;
    }
    if (key === '--body') {
      out.body = val;
      i++;
      continue;
    }
    if (key === '--attach') {
      out.attach.push(val);
      i++;
      continue;
    }
    if (key.startsWith('--')) i++;
  }
  return out;
}

function encodeSubject(subject) {
  if (/^[\x20-\x7E]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
}

function buildRawEmail({ to, subject, body, attachments = [] }) {
  if (!attachments.length) {
    const lines = [
      `To: ${to}`,
      `Subject: ${encodeSubject(subject)}`,
      'MIME-Version: 1.0',
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

  const boundary = `ct_boundary_${Date.now()}`;
  const parts = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body,
  ];

  for (const filePath of attachments) {
    const filename = path.basename(filePath);
    const data = fs.readFileSync(filePath);
    const b64 = data.toString('base64').replace(/(.{76})/g, '$1\r\n');
    const mime =
      filename.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : 'application/octet-stream';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mime}; name="${filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filename}"`,
      '',
      b64,
    );
  }
  parts.push(`--${boundary}--`, '');
  return Buffer.from(parts.join('\r\n'))
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
        res.on('data', (c) => {
          data += c;
        });
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
  console.error(
    'Usage: send-email.mjs --to ADDR --subject TEXT --body TEXT [--attach PATH] [--registry shadow-google]',
  );
  process.exit(1);
}

const accessToken = getAccessToken(args.registry);
const raw = buildRawEmail({
  to: args.to,
  subject: args.subject,
  body: args.body,
  attachments: args.attach || [],
});
const result = await gmailSend(accessToken, raw);
if (result.error) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ id: result.id, threadId: result.threadId }, null, 2));
