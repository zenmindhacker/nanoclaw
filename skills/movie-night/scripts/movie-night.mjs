#!/usr/bin/env node
/**
 * Movie Night v2 — thin facts layer: library index, TD candidates, OMDB enrich, guarded download.
 * Cleo handles ownership, taste filters, and presentation.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { loadTdConfig, parseReleaseName, searchTorrents, downloadTorrent, listCategories, resolveCategories } from "../../torrentday/scripts/torrentday.mjs";
import { browseMovies } from "../../torrentday/scripts/browserbase.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");
const GROUP_DIR = "/workspace/group";
const AGENT_DIR = "/workspace/agent";

function groupDir() {
  if (existsSync(AGENT_DIR)) return AGENT_DIR;
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
function lastSearchPath() { return join(groupDir(), "movie-night-last-search.json"); }
function diskFolderCachePath() { return join(groupDir(), "remembrall-disk-folders.json"); }

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

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
    join(groupDir(), "movie-preferences.json"),
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

function defaultCategory() {
  const prefs = loadPreferences();
  return prefs.default_category || prefs.preferred_quality || "movX265";
}

function mapCandidate(row, source) {
  const sizeBytes = typeof row.size === "number" ? row.size : null;
  return {
    id: row.id ?? row.t,
    name: row.name,
    seeders: row.seeders ?? row.seeds ?? 0,
    sizeBytes,
    sizeGb: sizeBytes != null ? Math.round((sizeBytes / 1e9) * 100) / 100 : null,
    categoryId: row.category ?? null,
    parsed: row.parsed || parseReleaseName(row.name),
    source,
  };
}

export async function findCandidates(query, { limit = 15, rawLimit = 30, category } = {}) {
  if (!query?.trim()) throw new Error("candidates requires --query");
  const categoryName = category || defaultCategory();
  const categoryIds = resolveCategories(categoryName);
  const searchQuery = query.trim();
  const td = loadTdConfig();
  let rows = [];

  try {
    rows = await searchTorrents(td, { query: searchQuery, category: categoryName, sort: "seeders" });
  } catch {}

  if (!rows.length || rows[0]?.source === "rss") {
    try {
      const browsed = await browseMovies({ query: searchQuery, limit: rawLimit, category: categoryName });
      rows = browsed.map((r) => mapCandidate(r, "browser"));
    } catch (e) {
      if (!rows.length) throw e;
      rows = rows.map((r) => mapCandidate(r, r.source || "tjson"));
    }
  } else {
    rows = rows.map((r) => mapCandidate(r, r.source || "tjson"));
  }

  const candidates = rows
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, limit);

  const result = {
    query: searchQuery,
    searchQuery,
    category: categoryName,
    categoryIds,
    candidates,
    generatedAt: new Date().toISOString(),
  };
  saveJson(lastSearchPath(), result);
  return result;
}

function loadDiskFolderCache() {
  return loadJson(diskFolderCachePath(), { folders: [] }).folders || [];
}

function saveDiskFolderCache(folders) {
  if (!folders.length) return;
  saveJson(diskFolderCachePath(), { updatedAt: new Date().toISOString(), folders });
}

function listRemembrallDiskFolders() {
  const host = process.env.REMEMBRALL_SSH || "root@100.82.7.74";
  try {
    const out = execFileSync(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new", host, "ls -1 /mnt/movies"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    const folders = out.split("\n").map((l) => l.trim()).filter((n) => n && !n.startsWith("."));
    saveDiskFolderCache(folders);
    return folders;
  } catch {
    return loadDiskFolderCache();
  }
}

function diskEntryId(filename) {
  return `disk-${filename.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 60)}`;
}

function libraryEntry(filename, source, id) {
  return {
    id,
    source,
    filename,
    path: `smb://remembrall/Movies/${filename}`,
  };
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
  const byFilename = new Map();

  for (const t of torrents) {
    if (t.percentDone < 0.95) continue;
    byFilename.set(t.name, libraryEntry(t.name, "transmission", `tx-${t.id}`));
  }

  for (const folder of listRemembrallDiskFolders()) {
    if (byFilename.has(folder)) continue;
    byFilename.set(folder, libraryEntry(folder, "disk", diskEntryId(folder)));
  }

  const entries = [...byFilename.values()];
  const lib = { updatedAt: new Date().toISOString(), entries };
  saveJson(libraryPath(), lib);
  return lib;
}

export function loadLibrary() {
  const lib = loadJson(libraryPath(), { entries: [], updatedAt: null });
  if (!lib.entries && lib.movies) {
    lib.entries = lib.movies.map((m) => ({
      id: m.id || diskEntryId(m.filename),
      source: m.source || "unknown",
      filename: m.filename,
      path: m.path || `smb://remembrall/Movies/${m.filename}`,
    }));
  }
  return lib;
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

async function omdbLookup(title, year, cache) {
  const key = loadOmdbKey();
  const cacheKey = `${(title || "").toLowerCase()}|${year || ""}`;
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

export async function downloadPick(n) {
  const last = loadJson(lastSearchPath(), null);
  if (!last?.candidates?.length) throw new Error("No prior candidates — run candidates first");
  const idx = parseInt(n, 10) - 1;
  if (idx < 0 || idx >= last.candidates.length) {
    throw new Error(`Invalid pick ${n}; ${last.candidates.length} candidates in last search`);
  }
  const pick = last.candidates[idx];
  const td = loadTdConfig();
  const out = `/tmp/movie-${pick.id}.torrent`;
  await downloadTorrent(td, pick.id, out);
  const txScript = existsSync("/workspace/extra/skills/transmission/scripts/transmission.mjs")
    ? "/workspace/extra/skills/transmission/scripts/transmission.mjs"
    : join(process.env.HOME || "", "nanoclaw/skills/transmission/scripts/transmission.mjs");
  execFileSync("node", [txScript, "add", out], { encoding: "utf8" });
  await refreshLibrary();
  return { pick, torrent: out, message: `Added to Transmission: ${pick.parsed?.title || pick.name}` };
}

function libraryStatus() {
  const lib = loadLibrary();
  const diskCache = loadDiskFolderCache();
  const tx = runTransmissionList().filter((t) => t.percentDone >= 0.95);
  return {
    groupDir: groupDir(),
    entryCount: lib.entries?.length ?? 0,
    transmissionComplete: tx.length,
    diskFoldersCached: diskCache.length,
    updatedAt: lib.updatedAt,
  };
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
      else console.log(`Library refreshed: ${lib.entries.length} entries`);
      return;
    }
    if (sub === "status") {
      const status = libraryStatus();
      if (json) console.log(JSON.stringify(status, null, 2));
      else {
        console.log(`Library: ${status.entryCount} entries (${status.groupDir})`);
        console.log(`Transmission: ${status.transmissionComplete} complete | Disk cache: ${status.diskFoldersCached} folders`);
        if (status.updatedAt) console.log(`Updated: ${status.updatedAt}`);
      }
      return;
    }
    const lib = loadLibrary();
    if (json) console.log(JSON.stringify(lib.entries ?? [], null, 2));
    else for (const e of lib.entries ?? []) console.log(`- ${e.filename} [${e.source}]`);
    return;
  }

  if (cmd === "categories") {
    const cats = listCategories();
    if (json) console.log(JSON.stringify(cats, null, 2));
    else {
      for (const c of cats) console.log(`${c.name} (${c.ids.join(",")}) — ${c.label}: ${c.useWhen}`);
    }
    return;
  }

  if (cmd === "candidates") {
    const query = args.query || args._[1];
    if (!query) {
      console.error("Usage: movie-night.sh candidates --query \"Title\" [--category movX265|movPACKS|...] [--limit N] [--json]");
      process.exit(1);
    }
    const result = await findCandidates(query, {
      limit: args.limit ? parseInt(args.limit, 10) : 15,
      category: args.category,
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Query: ${result.query} | Category: ${result.category}`);
      result.candidates.forEach((c, i) => {
        const sz = c.sizeGb != null ? ` ${c.sizeGb}GB` : "";
        console.log(`${i + 1}. [${c.id}] ${c.seeders}s${sz} | ${c.name}`);
      });
      console.log(`--- ${result.candidates.length} candidate(s)`);
    }
    return;
  }

  if (cmd === "download") {
    const r = await downloadPick(args._[1]);
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.message);
    return;
  }

  if (cmd === "enrich") {
    const cache = loadJson(omdbCachePath(), {});
    const name = args._.slice(1).join(" ") || args.query;
    const parsed = parseReleaseName(name);
    const title = args.title || parsed.title || name;
    const year = args.year ? parseInt(args.year, 10) : parsed.year;
    const meta = await omdbLookup(title, year, cache);
    saveJson(omdbCachePath(), cache);
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  console.log(`Usage: movie-night.sh <library|library refresh|library status|categories|candidates|download|enrich> [options]`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
