import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import https from 'https';

function resolveCredPath(filename) {
  const containerPath = `/workspace/extra/credentials/${filename}`;
  if (existsSync('/workspace/extra/credentials')) return containerPath;
  return resolve(homedir(), `.config/nanoclaw/credentials/services/${filename}`);
}

const token = JSON.parse(readFileSync(resolveCredPath('google-gmail-token.json'), 'utf8'));

function gmailGet(rawPath) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/' + rawPath);
  return new Promise((res, rej) => {
    https.request(url, { headers: { Authorization: 'Bearer ' + token.access_token } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => res(JSON.parse(d)));
    }).end();
  });
}

function scanParts(part, results) {
  if (part.filename) {
    results.attachments.push({ name: part.filename, mime: part.mimeType, size: part.body?.size || 0 });
  }
  if (part.mimeType === 'text/plain' && part.body?.data && !part.filename) {
    results.body += Buffer.from(part.body.data, 'base64url').toString();
  }
  for (const c of part.parts || []) scanParts(c, results);
}

// ar@ emails (Rustam invoices)
console.log('=== ar@newvaluegroup.com EMAILS (Rustam invoices) ===\n');
const arMsgs = await gmailGet('messages?q=from%3Aar%40newvaluegroup.com&maxResults=5');
for (const msg of (arMsgs.messages || []).slice(0, 3)) {
  const d = await gmailGet('messages/' + msg.id + '?format=full');
  const hdrs = d.payload?.headers || [];
  const subj = hdrs.find(h => h.name === 'Subject')?.value;
  const date = hdrs.find(h => h.name === 'Date')?.value;
  const results = { attachments: [], body: '' };
  scanParts(d.payload, results);
  console.log(`Date: ${date}`);
  console.log(`Subject: ${subj}`);
  console.log(`ID: ${msg.id}`);
  console.log(`Attachments: ${results.attachments.length ? results.attachments.map(a => `${a.name} (${a.mime}, ${a.size}b)`).join(', ') : 'none'}`);
  console.log(`Body preview: ${results.body.replace(/[\r\n]+/g, ' ').slice(0, 250)}`);
  console.log();
}

// ap@ emails (POs)
console.log('=== ap@newvaluegroup.com EMAILS (POs / commissions) ===\n');
const apMsgs = await gmailGet('messages?q=from%3Aap%40newvaluegroup.com&maxResults=5');
for (const msg of (apMsgs.messages || []).slice(0, 3)) {
  const d = await gmailGet('messages/' + msg.id + '?format=full');
  const hdrs = d.payload?.headers || [];
  const subj = hdrs.find(h => h.name === 'Subject')?.value;
  const date = hdrs.find(h => h.name === 'Date')?.value;
  const results = { attachments: [], body: '' };
  scanParts(d.payload, results);
  console.log(`Date: ${date}`);
  console.log(`Subject: ${subj}`);
  console.log(`ID: ${msg.id}`);
  console.log(`Attachments: ${results.attachments.length ? results.attachments.map(a => `${a.name} (${a.mime}, ${a.size}b)`).join(', ') : 'none'}`);
  console.log(`Body preview: ${results.body.replace(/[\r\n]+/g, ' ').slice(0, 250)}`);
  console.log();
}

// Also check the existing Xero invoice INV-0115 as reference
console.log('=== Reference: INV-0115 search in email ===\n');
const refMsgs = await gmailGet('messages?q=INV-0115&maxResults=3');
for (const msg of (refMsgs.messages || []).slice(0, 2)) {
  const d = await gmailGet('messages/' + msg.id + '?format=full');
  const hdrs = d.payload?.headers || [];
  const subj = hdrs.find(h => h.name === 'Subject')?.value;
  const from = hdrs.find(h => h.name === 'From')?.value;
  const date = hdrs.find(h => h.name === 'Date')?.value;
  console.log(`Date: ${date}`);
  console.log(`From: ${from}`);
  console.log(`Subject: ${subj}`);
  console.log();
}
