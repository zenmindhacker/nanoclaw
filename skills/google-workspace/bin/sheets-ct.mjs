#!/usr/bin/env node
/**
 * sheets-ct — Google Sheets CLI for Connected Tutors.
 *
 * Primitives: get-range, get-column, append-rows, find-row, update-cell, create-sheet.
 * Uses existing access-token.mjs auth (connected-tutors-google OAuth).
 * JSON output by default for machine callers.
 *
 * Default spreadsheet ID from CT_TRACKER_SHEET_ID env var.
 */

import { readFileSync } from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { getAccessToken } = await import(resolve(__dirname, '../lib/access-token.mjs'));

// NanoClaw host OAuth default; laptop sets CT_GOOGLE_REGISTRY=connected-tutors-google
const REGISTRY_ID =
  process.env.CT_GOOGLE_REGISTRY ||
  process.env.GOOGLE_REGISTRY_ID ||
  'shadow-google';
const DEFAULT_SHEET_ID = process.env.CT_TRACKER_SHEET_ID
  || '1RrKENfjS5Q_rCVkaNDXM77Y7QsnZtqm8934zvU2T_3U';

function sheetsApi(method, path, body) {
  return new Promise((resolvePromise, reject) => {
    const opts = {
      hostname: 'sheets.googleapis.com',
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    Promise.resolve(getAccessToken(REGISTRY_ID)).then((token) => {
      opts.headers['Authorization'] = `Bearer ${token}`;
      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          } else {
            try { resolvePromise(JSON.parse(data)); } catch { resolvePromise(data); }
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    }).catch(reject);
  });
}

function encRange(sheet, range) {
  const full = range ? `${sheet}!${range}` : sheet;
  return encodeURIComponent(full);
}

// --- Commands ---

async function cmdGetRange(spreadsheetId, sheet, range) {
  const path = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, range)}`;
  const resp = await sheetsApi('GET', path);
  const rows = resp.values || [];
  console.log(JSON.stringify({ range: resp.range, rows, count: rows.length }));
}

async function cmdGetColumn(spreadsheetId, sheet, columnName) {
  const headerPath = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, '1:1')}`;
  const headerResp = await sheetsApi('GET', headerPath);
  const headers = (headerResp.values || [[]])[0];
  const colIdx = headers.findIndex((h) => h === columnName);
  if (colIdx === -1) {
    console.error(`Column "${columnName}" not found. Available: ${headers.join(', ')}`);
    process.exit(1);
  }
  const colLetter = colIndexToLetter(colIdx);
  const dataPath = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, `${colLetter}2:${colLetter}`)}`;
  const dataResp = await sheetsApi('GET', dataPath);
  const values = (dataResp.values || []).map((r) => r[0] || '');
  console.log(JSON.stringify({ column: columnName, values, count: values.length }));
}

async function cmdAppendRows(spreadsheetId, sheet, file, skipHeader) {
  let rows;
  if (file === '-' || !file) {
    const stdin = readFileSync(0, 'utf8');
    rows = JSON.parse(stdin);
  } else {
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
      rows = JSON.parse(content);
    } else {
      rows = content.trim().split('\n').map((line) => parseCSVLine(line));
      if (skipHeader && rows.length > 0) rows.shift();
    }
  }
  if (rows.length === 0) {
    console.log(JSON.stringify({ appended: 0 }));
    return;
  }
  const path = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, 'A:Z')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const body = { values: rows };
  const resp = await sheetsApi('POST', path, body);
  const updatedRows = resp.updates?.updatedRows || rows.length;
  console.log(JSON.stringify({ appended: updatedRows, range: resp.updates?.updatedRange }));
}

async function cmdFindRow(spreadsheetId, sheet, columnName, value) {
  const headerPath = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, '1:1')}`;
  const headerResp = await sheetsApi('GET', headerPath);
  const headers = (headerResp.values || [[]])[0];
  const colIdx = headers.findIndex((h) => h === columnName);
  if (colIdx === -1) {
    console.error(`Column "${columnName}" not found. Available: ${headers.join(', ')}`);
    process.exit(1);
  }
  const allPath = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, 'A:Z')}`;
  const allResp = await sheetsApi('GET', allPath);
  const allRows = allResp.values || [];
  const matches = [];
  for (let i = 1; i < allRows.length; i++) {
    if ((allRows[i][colIdx] || '') === value) {
      const rowData = {};
      headers.forEach((h, j) => { rowData[h] = allRows[i][j] || ''; });
      matches.push({ row: i + 1, data: rowData });
    }
  }
  console.log(JSON.stringify({ column: columnName, value, matches, count: matches.length }));
}

async function cmdUpdateCell(spreadsheetId, sheet, cell, value) {
  const path = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, cell)}?valueInputOption=USER_ENTERED`;
  const body = { values: [[value]] };
  const resp = await sheetsApi('PUT', path, body);
  console.log(JSON.stringify({ updated: resp.updatedCells || 1, range: resp.updatedRange }));
}

async function cmdDeleteSheet(spreadsheetId, title) {
  const metaPath = `/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`;
  const meta = await sheetsApi('GET', metaPath);
  const match = (meta.sheets || []).find((s) => s.properties.title === title);
  if (!match) {
    console.error(`Tab "${title}" not found`);
    process.exit(1);
  }
  const path = `/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  await sheetsApi('POST', path, {
    requests: [{ deleteSheet: { sheetId: match.properties.sheetId } }],
  });
  console.log(JSON.stringify({ deleted: title }));
}

async function cmdListTabs(spreadsheetId) {
  const path = `/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId,index)`;
  const resp = await sheetsApi('GET', path);
  const tabs = (resp.sheets || []).map((s) => s.properties.title);
  console.log(JSON.stringify({ tabs, count: tabs.length }));
}

async function cmdClearRange(spreadsheetId, sheet, range) {
  const path = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, range)}:clear`;
  const resp = await sheetsApi('POST', path, {});
  console.log(JSON.stringify({ cleared: resp.clearedRange }));
}

async function cmdSetRange(spreadsheetId, sheet, range, file) {
  let rows;
  if (file === '-' || !file) {
    rows = JSON.parse(readFileSync(0, 'utf8'));
  } else {
    const content = readFileSync(file, 'utf8');
    if (file.endsWith('.json')) {
      rows = JSON.parse(content);
    } else {
      rows = content.trim().split('\n').map((line) => parseCSVLine(line));
    }
  }
  const path = `/v4/spreadsheets/${spreadsheetId}/values/${encRange(sheet, range)}?valueInputOption=USER_ENTERED`;
  const resp = await sheetsApi('PUT', path, { values: rows });
  console.log(JSON.stringify({ updated: resp.updatedCells || 0, range: resp.updatedRange }));
}

async function cmdCreateSheet(spreadsheetId, title) {
  const path = `/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const body = {
    requests: [{
      addSheet: {
        properties: { title },
      },
    }],
  };
  const resp = await sheetsApi('POST', path, body);
  const props = resp.replies?.[0]?.addSheet?.properties;
  console.log(JSON.stringify({ created: title, sheetId: props?.sheetId }));
}

async function cmdGetSheetId(spreadsheetId, title) {
  const path = `/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`;
  const meta = await sheetsApi('GET', path);
  const match = (meta.sheets || []).find((s) => s.properties.title === title);
  if (!match) {
    console.error(`Tab "${title}" not found`);
    process.exit(1);
  }
  console.log(JSON.stringify({ title, sheetId: match.properties.sheetId }));
}

async function cmdBatchUpdate(spreadsheetId, file) {
  let body;
  if (file === '-' || !file) {
    body = JSON.parse(readFileSync(0, 'utf8'));
  } else {
    body = JSON.parse(readFileSync(file, 'utf8'));
  }
  if (!body.requests || !Array.isArray(body.requests)) {
    throw new Error('batch-update expects JSON with a requests array');
  }
  const path = `/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
  const resp = await sheetsApi('POST', path, body);
  console.log(JSON.stringify({
    replies: (resp.replies || []).length,
    spreadsheetId: resp.spreadsheetId,
  }));
}

// --- Helpers ---

function colIndexToLetter(idx) {
  let s = '';
  idx++;
  while (idx > 0) {
    idx--;
    s = String.fromCharCode(65 + (idx % 26)) + s;
    idx = Math.floor(idx / 26);
  }
  return s;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

// --- CLI ---

function usage() {
  console.error(`Usage: sheets-ct <command> [options]

Commands:
  get-range    --sheet NAME [--range A1:Z50]
  get-column   --sheet NAME --column COL_NAME
  append-rows  --sheet NAME --file data.csv [--skip-header]
  find-row     --sheet NAME --column COL_NAME --value VALUE
  update-cell  --sheet NAME --cell A1 --value VALUE
  clear-range  --sheet NAME --range A2:Z100
  set-range    --sheet NAME --range A1 --file data.json
  list-tabs    [--spreadsheet ID]
  create-sheet --title NAME
  delete-sheet --title NAME
  get-sheet-id --title NAME
  batch-update  --file requests.json   # { "requests": [ ... ] }

Options:
  --spreadsheet ID   Google Sheet ID (default: CT_TRACKER_SHEET_ID env or Master Tracker)

Output: JSON to stdout. Errors to stderr.`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else { args[key] = true; }
    } else {
      positional.push(argv[i]);
    }
  }
  return { command: positional[0], args };
}

const { command, args } = parseArgs(process.argv.slice(2));
const spreadsheetId = args.spreadsheet || DEFAULT_SHEET_ID;

try {
  switch (command) {
    case 'get-range':
      if (!args.sheet) usage();
      await cmdGetRange(spreadsheetId, args.sheet, args.range);
      break;
    case 'get-column':
      if (!args.sheet || !args.column) usage();
      await cmdGetColumn(spreadsheetId, args.sheet, args.column);
      break;
    case 'append-rows':
      if (!args.sheet) usage();
      await cmdAppendRows(spreadsheetId, args.sheet, args.file, !!args['skip-header']);
      break;
    case 'find-row':
      if (!args.sheet || !args.column || !args.value) usage();
      await cmdFindRow(spreadsheetId, args.sheet, args.column, args.value);
      break;
    case 'update-cell':
      if (!args.sheet || !args.cell || args.value === undefined) usage();
      await cmdUpdateCell(spreadsheetId, args.sheet, args.cell, args.value);
      break;
    case 'clear-range':
      if (!args.sheet || !args.range) usage();
      await cmdClearRange(spreadsheetId, args.sheet, args.range);
      break;
    case 'set-range':
      if (!args.sheet || !args.range) usage();
      await cmdSetRange(spreadsheetId, args.sheet, args.range, args.file);
      break;
    case 'list-tabs':
      await cmdListTabs(spreadsheetId);
      break;
    case 'delete-sheet':
      if (!args.title) usage();
      await cmdDeleteSheet(spreadsheetId, args.title);
      break;
    case 'create-sheet':
      if (!args.title) usage();
      await cmdCreateSheet(spreadsheetId, args.title);
      break;
    case 'get-sheet-id':
      if (!args.title) usage();
      await cmdGetSheetId(spreadsheetId, args.title);
      break;
    case 'batch-update':
      await cmdBatchUpdate(spreadsheetId, args.file);
      break;
    default:
      usage();
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
