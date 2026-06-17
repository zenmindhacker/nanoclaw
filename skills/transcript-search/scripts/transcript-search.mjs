#!/usr/bin/env node
/**
 * transcript-search — query meeting transcripts from local SQLite (read-only).
 * Uses node:sqlite (built into Node 22+) — no npm install required.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { SHADOW_DB_PATH } from './config.mjs';
import {
  openDb,
  searchConversations,
  formatTranscript,
  buildSearchQuery,
  buildMarkdownDocument,
  fetchGrepExcerpts,
  loadFullConversation,
} from './db.mjs';
import { getPreset, listPresets } from './presets.mjs';

function usage() {
  console.log(`transcript-search — query meeting transcripts (read-only)

DB: ${SHADOW_DB_PATH}

Usage:
  node scripts/transcript-search.mjs presets
  node scripts/transcript-search.mjs preset <name> [options]
  node scripts/transcript-search.mjs search [options]
  node scripts/transcript-search.mjs show <convIdx> [--output FILE] [--json]
  node scripts/transcript-search.mjs extract [search options] --output FILE
  node scripts/transcript-search.mjs excerpts [search options] --grep TERM
  node scripts/transcript-search.mjs excerpts <convIdx> --grep TERM
  node scripts/transcript-search.mjs sql [options]

Options:
  --since-days N   --from DATE   --to DATE   --title TEXT
  --grep TEXT      --grep-speaker NAME
  --attendee-email E   --attendee-domain D   --attendee-name N
  --calendar-id ID   --any TEXT   --preset NAME   --limit N
  --output FILE    Write transcript(s) to file (show, extract)
  --json           Machine-readable stdout (show, search, excerpts)

Examples:
  node scripts/transcript-search.mjs preset ganttsy --since-days 30
  node scripts/transcript-search.mjs search --preset ganttsy --grep "project onboarding"
  node scripts/transcript-search.mjs show 460
  node scripts/transcript-search.mjs show 460 --output /tmp/ganttsy-planning-460.md
  node scripts/transcript-search.mjs extract --preset ganttsy --grep "project onboarding" --output /tmp/onboarding.md
  node scripts/transcript-search.mjs excerpts --preset ganttsy --grep "project onboarding"
`);
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
      i++;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }
  return { command: positional[0] || 'help', positional: positional.slice(1), flags };
}

function flagsToFilters(flags, presetName) {
  const filters = {};
  if (typeof flags['since-days'] === 'string') filters.sinceDays = parseInt(flags['since-days'], 10);
  if (typeof flags.from === 'string') filters.from = flags.from;
  if (typeof flags.to === 'string') filters.to = flags.to;
  if (typeof flags.title === 'string') filters.title = flags.title;
  if (typeof flags.grep === 'string') filters.grep = flags.grep;
  if (typeof flags['grep-speaker'] === 'string') filters.grepSpeaker = flags['grep-speaker'];
  if (typeof flags['attendee-email'] === 'string') filters.attendeeEmail = flags['attendee-email'];
  if (typeof flags['attendee-domain'] === 'string') filters.attendeeDomain = flags['attendee-domain'];
  if (typeof flags['attendee-name'] === 'string') filters.attendeeName = flags['attendee-name'];
  if (typeof flags['calendar-id'] === 'string') filters.calendarId = flags['calendar-id'];
  if (typeof flags.any === 'string') filters.any = flags.any;
  if (typeof flags.limit === 'string') filters.limit = parseInt(flags.limit, 10);

  const presetKey = presetName || (typeof flags.preset === 'string' ? flags.preset : undefined);
  if (presetKey) {
    const preset = getPreset(presetKey);
    if (!preset) throw new Error(`Unknown preset: ${presetKey}. Run 'presets' to list.`);
    filters.presetSql = preset.sql;
    filters.presetParams = preset.extraParams;
    if (preset.grep && !filters.grep) filters.presetGrep = preset.grep;
  }
  return filters;
}

function shortCal(calendarId) {
  if (calendarId.includes('group.calendar.google.com')) return 'CT-shared';
  if (calendarId === 'primary') return 'primary';
  return calendarId.split('@')[0] ?? calendarId;
}

function writeOutput(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
  console.error(`Wrote ${path} (${content.length} bytes)`);
}

function printResults(rows, json, presetName) {
  if (json) {
    console.log(JSON.stringify({ count: rows.length, preset: presetName ?? null, results: rows }, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log('No matches.');
    return;
  }
  for (const r of rows) {
    const date = r.convStartedAt?.slice(0, 10) ?? '';
    const cal = r.calendarId ? ` [${shortCal(r.calendarId)}]` : '';
    const attendees = r.attendeeSummary ? ` — ${r.attendeeSummary}` : '';
    console.log(`${r.convIdx}\t${date}\t${r.convTitle}${cal}${attendees}`);
  }
  console.log(`\n${rows.length} result(s).`);
  console.log('Next: show <convIdx> | show <convIdx> --output FILE | extract [filters] --output FILE | excerpts --grep TERM');
}

function renderShow(convIdx, { json, output }) {
  const db = openDb();
  const loaded = loadFullConversation(db, convIdx);
  if (!loaded) throw new Error(`Conversation ${convIdx} not found.`);

  const { conv, attendees, lines, cal } = loaded;
  const markdown = buildMarkdownDocument(conv, attendees, cal, lines);

  if (output) {
    writeOutput(output, markdown);
    return;
  }

  if (json) {
    console.log(
      JSON.stringify(
        {
          ...conv,
          attendees,
          calEvent: cal ?? null,
          transcript: formatTranscript(lines),
          markdown,
          segmentCount: lines.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(markdown);
}

function resolvePresetName(flags, positional) {
  if (typeof flags.preset === 'string') return flags.preset;
  if (positional[0] && !/^\d+$/.test(positional[0]) && getPreset(positional[0])) return positional[0];
  return undefined;
}

function cmdExtract(flags, positional) {
  const output = flags.output;
  if (!output || typeof output !== 'string') {
    throw new Error('extract requires --output FILE');
  }

  const db = openDb();
  const filters = flagsToFilters(flags, resolvePresetName(flags, positional));
  const rows = searchConversations(db, filters);
  if (rows.length === 0) throw new Error('No matches to extract.');

  const sections = [];
  for (const row of rows) {
    const loaded = loadFullConversation(db, row.convIdx);
    if (!loaded) continue;
    sections.push(buildMarkdownDocument(loaded.conv, loaded.attendees, loaded.cal, loaded.lines));
  }

  const combined = sections.join('\n\n---\n\n');
  writeOutput(output, combined);
  if (!flags.json) {
    console.log(`Extracted ${sections.length} transcript(s) to ${output}`);
    for (const r of rows) {
      console.log(`  ${r.convIdx}\t${r.convTitle}`);
    }
  } else {
    console.log(JSON.stringify({ output, count: sections.length, convIdxs: rows.map((r) => r.convIdx) }, null, 2));
  }
}

function cmdExcerpts(positional, flags) {
  const grep = typeof flags.grep === 'string' ? flags.grep : undefined;
  if (!grep) throw new Error('excerpts requires --grep TERM');

  const db = openDb();
  let convRows = [];

  if (positional[0] && /^\d+$/.test(positional[0])) {
    const conv = loadFullConversation(db, parseInt(positional[0], 10));
    if (!conv) throw new Error(`Conversation ${positional[0]} not found.`);
    convRows = [conv.conv];
  } else {
    convRows = searchConversations(db, flagsToFilters(flags, resolvePresetName(flags, positional)));
  }

  const results = [];
  for (const row of convRows) {
    const hits = fetchGrepExcerpts(db, row.convIdx, grep);
    if (hits.length) {
      results.push({
        convIdx: row.convIdx,
        convTitle: row.convTitle,
        convStartedAt: row.convStartedAt,
        hits,
      });
    }
  }

  if (flags.json) {
    console.log(JSON.stringify({ grep, count: results.length, results }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No excerpts matching "${grep}".`);
    return;
  }

  for (const r of results) {
    console.log(`\n## ${r.convIdx} — ${r.convTitle} (${r.convStartedAt?.slice(0, 10) ?? ''})`);
    for (const h of r.hits) {
      console.log(`  [${h.speaker}] ${h.excerpt}`);
    }
  }
  console.log(`\n${results.length} meeting(s) with matches. Use 'show <convIdx>' or 'extract ... --output FILE' for full text.`);
}

function cmdPresets(json) {
  const presets = listPresets();
  if (json) {
    console.log(JSON.stringify(presets.map((p) => ({ name: p.name, description: p.description, grep: p.grep ?? null })), null, 2));
    return;
  }
  for (const p of presets) {
    const grep = p.grep ? ` (+grep: ${p.grep})` : '';
    console.log(`  ${p.name.padEnd(20)} ${p.description}${grep}`);
  }
}

function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const json = Boolean(flags.json);
  const output = typeof flags.output === 'string' ? flags.output : undefined;

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        usage();
        break;
      case 'presets':
        cmdPresets(json);
        break;
      case 'preset': {
        const name = positional[0];
        if (!name) throw new Error('Usage: preset <name> [options]');
        printResults(searchConversations(openDb(), flagsToFilters(flags, name)), json, name);
        break;
      }
      case 'search': {
        printResults(
          searchConversations(openDb(), flagsToFilters(flags)),
          json,
          typeof flags.preset === 'string' ? flags.preset : undefined,
        );
        break;
      }
      case 'sql': {
        const { sql, params } = buildSearchQuery(flagsToFilters(flags, positional[0]));
        console.log(sql.trim());
        console.log('-- params:', JSON.stringify(params));
        break;
      }
      case 'show': {
        const idx = parseInt(positional[0] ?? '', 10);
        if (!idx) throw new Error('Usage: show <convIdx> [--output FILE] [--json]');
        renderShow(idx, { json, output });
        break;
      }
      case 'extract':
        cmdExtract(flags, positional);
        break;
      case 'excerpts':
        cmdExcerpts(positional, flags);
        break;
      default:
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
