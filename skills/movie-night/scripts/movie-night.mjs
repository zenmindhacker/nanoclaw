#!/usr/bin/env node
/**
 * Movie Night — library index, OMDB enrich, TorrentDay suggest, transmission download.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { loadTdConfig, parseReleaseName, searchTorrents, downloadTorrent } from "../../torrentday/scripts/torrentday.mjs";
import { browseMovies } from "../../torrentday/scripts/browserbase.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");
const GROUP_DIR = "/workspace/group";
function groupDir() {
  if (existsSync(GROUP_DIR)) return GROUP_DIR;
  const home = process.env.HOME || "";
  const agentGroup = home.includes("christina")
    ? join(home, "nanoclaw/agents/silas/groups/dm-with-christina")
    : join(home, "nanoclaw/agents/cleo/groups/dm-with-cian");
  const fallbacks = [agentGroup, join(SKILL_DIR, "data")];
  for (const p of fallbacks) {
    try {
      mkdirSync(p, { recursive: true });
      return p;
    } catch {}
  }
  return "/tmp/movie-night";
}
function libraryPath() { return join(groupDir(), "movie-library.json"); }
function omdbCachePath() { return join(groupDir(), "omdb-cache.json"); }
function lastSuggestPath() { return join(groupDir(), "movie-night-last-suggest.json"); }

function readYamlSimple(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      if (t.startsWith("- ")) continue;
      const i = t.indexOf(":");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (v.startsWith("[") && v.endsWith("]")) {
        out[k] = v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
      } else if (v === "[]") out[k] = [];
      else if (!isNaN(Number(v)) && v !== "") out[k] = Number(v);
      else out[k] = v;
    }
  } catch {}
  return out;
}

function loadPreferences() {
  const paths = [
    join(GROUP_DIR, "movie-preferences.json"),
    "/workspace/agent/movie-preferences.json",
    join(SKILL_DIR, "preferences.json"),
    join(SKILL_DIR, "preferences.yaml"),
  ];
  let prefs = {};
  for (const p of paths) {
    try {
      if (p.endsWith(".json")) {
        prefs = { ...prefs, ...JSON.parse(readFileSync(p, "utf8")) };
      } else {
        prefs = { ...prefs, ...readYamlSimple(p) };
      }
    } catch {}
  }
  return prefs;
}

function loadOmdbKey() {
  const paths = [
    "/workspace/extra/credentials/omdb",
    join(process.env.HOME || "", ".config/nanoclaw/credentials/services/omdb"),
    join(SKILL_DIR, "credentials"),
  ];
  for (const p of paths) {
    try {
      const raw = readFileSync(p, "utf8").trim();
      if (raw && !raw.startsWith("#") && !raw.includes("=")) return raw;
      const m = raw.match(/API_KEY=(.+)/);
      if (m) return m[1].trim();
    } catch {}
  }
  return process.env.OMDB_API_KEY || null;
}

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function libFile() { return libraryPath(); }
function omdbFile() { return omdbCachePath(); }
function suggestFile() { return lastSuggestPath(); }

function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function normalizeTitle(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function decadeOf(year) {
  if (!year) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

function parseDecadeArg(d) {
  if (!d) return null;
  const m = d.match(/(\d{4})s/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  return { start, end: start + 9 };
}

async function omdbLookup(title, year, cache) {
  const key = loadOmdbKey();
  const cacheKey = `${normalizeTitle(title)}|${year || ""}`;
  if (cache[cacheKey]) return cache[cacheKey];
  if (!key) {
    return { title, year, imdbRating: null, rated: null, genre: null, runtime: null, plot: null, imdbId: null, _missingKey: true };
  }
  const q = `apikey=${encodeURIComponent(key)}&t=${encodeURIComponent(title)}${year ? `&y=${year}` : ""}&plot=short`;
  const res = await fetch(`https://www.omdbapi.com/?${q}`);
  const data = await res.json();
  if (data.Response === "False") {
    cache[cacheKey] = { title, year, error: data.Error };
    return cache[cacheKey];
  }
  const entry = {
    title: data.Title,
    year: parseInt(data.Year, 10) || year,
    imdbId: data.imdbID,
    imdbRating: parseFloat(data.imdbRating) || null,
    rated: data.Rated,
    genre: data.Genre,
    runtime: data.Runtime,
    plot: data.Plot,
  };
  cache[cacheKey] = entry;
  return entry;
}

function runTransmissionList() {
  const script = "/workspace/extra/skills/transmission/scripts/transmission.mjs";
  const hostScript = join(process.env.HOME || "", "nanoclaw/skills/transmission/scripts/transmission.mjs");
  const path = existsSync(script) ? script : hostScript;
  try {
    const out = execFileSync("node", [path, "list", "--json"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(out);
  } catch {
    return [];
  }
}

export async function refreshLibrary() {
  const torrents = runTransmissionList();
  const cache = loadJson(omdbFile(), {});
  const movies = [];
  for (const t of torrents) {
    if (t.percentDone < 0.95) continue;
    const parsed = parseReleaseName(t.name);
    const meta = await omdbLookup(parsed.title || t.name, parsed.year, cache);
    movies.push({
      id: `tx-${t.id}`,
      source: "transmission",
      filename: t.name,
      path: `smb://remembrall/Movies/${t.name}`,
      parsed,
      ...meta,
    });
  }
  saveJson(omdbFile(), cache);
  const tasteProfile = buildTasteProfile(movies);
  const lib = { updatedAt: new Date().toISOString(), movies, tasteProfile };
  saveJson(libFile(), lib);
  return lib;
}

export function loadLibrary() {
  return loadJson(libFile(), { movies: [], tasteProfile: null, updatedAt: null });
}

function buildTasteProfile(movies) {
  const genres = {};
  const decades = {};
  const ratings = [];
  for (const m of movies) {
    if (m.imdbRating) ratings.push(m.imdbRating);
    if (m.genre) {
      for (const g of m.genre.split(",").map((s) => s.trim())) {
        genres[g] = (genres[g] || 0) + 1;
      }
    }
    const d = decadeOf(m.year || m.parsed?.year);
    if (d) decades[d] = (decades[d] || 0) + 1;
  }
  ratings.sort((a, b) => a - b);
  const topGenres = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  const topDecades = Object.entries(decades).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);
  return {
    topGenres,
    topDecades,
    medianImdb: ratings.length ? ratings[Math.floor(ratings.length / 2)] : null,
    count: movies.length,
  };
}

function isOwned(candidate, library) {
  const ct = normalizeTitle(candidate.parsed?.title || candidate.title || candidate.name);
  const cy = candidate.parsed?.year || candidate.year;
  for (const m of library.movies) {
    if (candidate.imdbId && m.imdbId && candidate.imdbId === m.imdbId) return { owned: true, match: m, confidence: "exact" };
    const mt = normalizeTitle(m.title || m.parsed?.title);
    const my = m.year || m.parsed?.year;
    if (ct && mt && (ct === mt || ct.includes(mt) || mt.includes(ct))) {
      if (!cy || !my || Math.abs(cy - my) <= 1) return { owned: true, match: m, confidence: "likely" };
    }
  }
  return { owned: false };
}

function passesFilters(meta, filters, prefs) {
  const minImdb = filters.minImdb ?? prefs.min_imdb ?? 7;
  if (minImdb != null) {
    if (meta.imdbRating == null) return false;
    if (meta.imdbRating < minImdb) return false;
  }
  if (filters.mpaa) {
    if (!meta.rated || meta.rated === "N/A") return false;
    if (filters.mpaa === "PG-13" && !["PG", "PG-13", "G"].includes(meta.rated)) return false;
    else if (meta.rated !== filters.mpaa) return false;
  }
  if (filters.decade) {
    const y = meta.year || meta.parsed?.year;
    if (!y || y < filters.decade.start || y > filters.decade.end) return false;
  }
  if (prefs.blocked_genres?.length && meta.genre) {
    for (const bg of prefs.blocked_genres) {
      if (meta.genre.toLowerCase().includes(bg.toLowerCase())) return false;
    }
  }
  if (prefs.blocked_mpaa?.length && meta.rated) {
    if (prefs.blocked_mpaa.includes(meta.rated)) return false;
  }
  return true;
}

function scoreCandidate(meta, torrent, taste, prefs) {
  let score = (torrent.seeders || 0) * 10 + (meta.imdbRating || 0) * 5;
  if (taste?.topGenres && meta.genre) {
    for (const g of taste.topGenres.slice(0, 3)) {
      if (meta.genre.includes(g)) score += 8;
    }
  }
  if (taste?.topDecades && meta.year) {
    const d = decadeOf(meta.year);
    if (taste.topDecades.includes(d)) score += 5;
  }
  return score;
}

async function enrichTorrent(t, cache) {
  const parsed = t.parsed || parseReleaseName(t.name);
  const meta = await omdbLookup(parsed.title || t.name, parsed.year, cache);
  return { ...t, parsed, ...meta, title: meta.title || parsed.title, year: meta.year || parsed.year };
}

function matchesQuery(meta, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const title = (meta.title || meta.parsed?.title || meta.filename || "").toLowerCase();
  return title.includes(q) || q.split(/\s+/).every((w) => title.includes(w));
}

export async function librarySearch(filters = {}) {
  let lib = loadLibrary();
  if (!lib.movies?.length || !lib.updatedAt) lib = await refreshLibrary();
  const prefs = loadPreferences();
  const out = [];
  for (const m of lib.movies) {
    const meta = { ...m, parsed: m.parsed || parseReleaseName(m.filename) };
    if (!passesFilters(meta, filters, prefs)) continue;
    if (!matchesQuery(meta, filters.query)) continue;
    out.push(meta);
  }
  out.sort((a, b) => (b.imdbRating || 0) - (a.imdbRating || 0));
  return out;
}

export async function suggest(opts = {}) {
  const prefs = loadPreferences();
  const filters = {
    minImdb: opts.minImdb ?? prefs.min_imdb,
    mpaa: opts.mpaa || null,
    decade: parseDecadeArg(opts.decade),
    query: opts.query || null,
  };
  let lib = loadLibrary();
  const weekMs = 7 * 24 * 3600 * 1000;
  if (!lib.updatedAt || Date.now() - new Date(lib.updatedAt).getTime() > weekMs) {
    lib = await refreshLibrary();
  }
  const ownedMatches = (await librarySearch(filters)).slice(0, 5);
  const cache = loadJson(omdbFile(), {});

  let candidates = [];
  if (opts.query) {
    const td = loadTdConfig();
    try {
      candidates = await searchTorrents(td, { query: opts.query, category: "movX265", limit: 30 });
    } catch {}
    if (!candidates.length || candidates[0]?.source === "rss") {
      try {
        const rows = await browseMovies({ query: opts.query, limit: 30 });
        candidates = rows.map((r) => ({
          id: r.id,
          name: r.name,
          seeders: r.seeds,
          parsed: parseReleaseName(r.name),
          source: "browser",
        }));
      } catch (e) {
        if (!candidates.length) throw e;
      }
    }
  } else {
    try {
      const rows = await browseMovies({ decade: opts.decade, limit: 40 });
      candidates = rows.map((r) => ({
        id: r.id,
        name: r.name,
        seeders: r.seeds,
        parsed: parseReleaseName(r.name),
        source: "browser",
      }));
    } catch {
      const td = loadTdConfig();
      candidates = await searchTorrents(td, { query: "", category: "movX265", limit: 40 });
    }
  }

  const enriched = [];
  for (const c of candidates) {
    const item = await enrichTorrent(c, cache);
    if (!passesFilters(item, filters, prefs)) continue;
    const own = isOwned(item, lib);
    if (own.owned) continue;
    item.score = scoreCandidate(item, c, lib.tasteProfile, prefs);
    enriched.push(item);
  }
  saveJson(omdbFile(), cache);
  enriched.sort((a, b) => b.score - a.score);
  const newOptions = enriched.slice(0, opts.limit ?? 5);
  const result = {
    owned: ownedMatches,
    newOptions,
    filters,
    generatedAt: new Date().toISOString(),
  };
  saveJson(suggestFile(), result);
  return result;
}

export async function downloadPick(n) {
  const last = loadJson(suggestFile(), null);
  if (!last) throw new Error("No prior suggest — run suggest first");
  const idx = parseInt(n, 10) - 1;
  if (idx < 0 || idx >= last.newOptions.length) throw new Error(`Invalid pick ${n}; ${last.newOptions.length} new options`);
  const pick = last.newOptions[idx];
  const td = loadTdConfig();
  const out = `/tmp/movie-${pick.id}.torrent`;
  await downloadTorrent(td, pick.id, out);
  const txScript = existsSync("/workspace/extra/skills/transmission/scripts/transmission.mjs")
    ? "/workspace/extra/skills/transmission/scripts/transmission.mjs"
    : join(process.env.HOME || "", "nanoclaw/skills/transmission/scripts/transmission.mjs");
  execFileSync("node", [txScript, "add", out], { encoding: "utf8" });
  await refreshLibrary();
  return { pick, torrent: out, message: `Added to Transmission: ${pick.title || pick.name}` };
}

function formatSuggest(result) {
  const lines = [];
  if (result.owned.length) {
    lines.push("ALREADY OWN (matches your search):");
    for (const m of result.owned) {
      const r = m.imdbRating != null ? `IMDb ${m.imdbRating}/10` : "rating n/a";
      lines.push(`  - ${m.title || m.parsed?.title} (${m.year || "?"}) — ${r}, on remembrall ✓  [no download needed]`);
    }
    lines.push("");
  }
  if (result.newOptions.length) {
    lines.push("NEW OPTIONS (TorrentDay):");
    result.newOptions.forEach((m, i) => {
      const r = m.imdbRating != null ? `IMDb ${m.imdbRating}/10` : "rating n/a";
      const mpaa = m.rated || "?";
      const genre = m.genre || "?";
      const gb = m.size ? `${(m.size / 1e9).toFixed(1)} GB` : "?";
      lines.push(`${i + 1}. ${m.title || m.name} (${m.year || "?"}) — ${r}, ${mpaa}, ${genre}`);
      lines.push(`   TD: ${m.seeders || 0} seeders, ${gb}, x265`);
      lines.push(`   [download-id: ${m.id}]`);
    });
  } else if (!result.owned.length) {
    lines.push("No matches found. Try broader filters or refresh torrentday login.");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      out[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    } else out._.push(argv[i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  const cmd = args._[0];

  if (cmd === "library") {
    const sub = args._[1];
    if (sub === "refresh") {
      const lib = await refreshLibrary();
      if (json) console.log(JSON.stringify(lib, null, 2));
      else console.log(`Library refreshed: ${lib.movies.length} titles`);
      return;
    }
    if (sub === "search") {
      const filters = {
        minImdb: args["min-imdb"] ? parseFloat(args["min-imdb"]) : undefined,
        mpaa: args.mpaa,
        decade: parseDecadeArg(args.decade),
        query: args.query || args._[2],
      };
      const rows = await librarySearch(filters);
      if (json) console.log(JSON.stringify(rows, null, 2));
      else for (const m of rows) console.log(`- ${m.title || m.filename} (${m.year}) ${m.imdbRating || ""}`);
      return;
    }
    const lib = loadLibrary();
    if (json) console.log(JSON.stringify(lib.movies, null, 2));
    else for (const m of lib.movies) console.log(`- ${m.title || m.filename} (${m.year || "?"})`);
    return;
  }

  if (cmd === "taste") {
    let lib = loadLibrary();
    if (!lib.tasteProfile) lib = await refreshLibrary();
    if (json) console.log(JSON.stringify(lib.tasteProfile, null, 2));
    else {
      const t = lib.tasteProfile;
      console.log(`Library: ${t.count} titles`);
      console.log(`Top genres: ${t.topGenres.join(", ")}`);
      console.log(`Top decades: ${t.topDecades.join(", ")}`);
      console.log(`Median IMDb: ${t.medianImdb ?? "n/a"}`);
    }
    return;
  }

  if (cmd === "suggest") {
    const result = await suggest({
      decade: args.decade,
      minImdb: args["min-imdb"] ? parseFloat(args["min-imdb"]) : undefined,
      mpaa: args.mpaa,
      query: args.query || args._[1],
      limit: args.limit ? parseInt(args.limit, 10) : 5,
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(formatSuggest(result));
    return;
  }

  if (cmd === "download") {
    const r = await downloadPick(args._[1]);
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.message);
    return;
  }

  if (cmd === "enrich") {
    const cache = loadJson(omdbFile(), {});
    const name = args._.slice(1).join(" ") || args.query;
    const parsed = parseReleaseName(name);
    const meta = await omdbLookup(parsed.title, parsed.year, cache);
    saveJson(omdbFile(), cache);
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  console.log(`Usage: movie-night.sh <library|library refresh|library search|taste|suggest|download|enrich> [options]`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
