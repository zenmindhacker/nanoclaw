#!/usr/bin/env node
/** TorrentDay CLI — t.json search, curl download, health. */
import { readFileSync, writeFileSync, createWriteStream } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CATEGORIES = {
  all: [],
  movX265: [48],
  movHD: [11],
  movBD: [5],
  mov4k: [96],
  movSDx264: [44],
  tvX265: [34],
  tvHDx264: [7],
  tv4k: [104],
};

function parseCredFile(paths) {
  const cfg = {};
  for (const p of paths) {
    try {
      const raw = readFileSync(p, "utf8");
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i === -1) continue;
        cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
      if (Object.keys(cfg).length) return cfg;
    } catch {}
  }
  return cfg;
}

export function loadTdConfig() {
  const cfg = parseCredFile([
    "/workspace/extra/credentials/torrentday",
    join(process.env.HOME || "", ".config/nanoclaw/credentials/services/torrentday"),
    join(__dirname, "..", "credentials"),
  ]);
  if (!cfg.UID || !cfg.PASSKEY) {
    throw new Error("Missing torrentday credentials (UID, PASSKEY)");
  }
  return {
    uid: cfg.UID,
    passkey: cfg.PASSKEY,
    username: cfg.USERNAME,
    password: cfg.PASSWORD,
    rssMovX265: cfg.RSS_MOVX265,
    baseUrl: "https://www.torrentday.com",
  };
}

export function parseReleaseName(name) {
  if (!name) return { title: "", year: null, raw: name };
  let s = name.replace(/\[.*?\]/g, " ").replace(/\s+/g, " ").trim();
  const yearMatch = s.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  let title = s
    .replace(/\b(19|20)\d{2}\b.*$/, "")
    .replace(/\b(480|720|1080|2160)p\b/gi, "")
    .replace(/\b(BluRay|WEB-?Rip|WEB-?DL|UHD|HDR|HEVC|x265|x264|REPACK|REMASTERED)\b/gi, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!title && year) title = s.split(String(year))[0].replace(/[._]/g, " ").trim();
  return { title, year, raw: name };
}

function buildJsonUrl(cfg, { categories = [48], query = "", free = false, sort = "" }) {
  const parts = [...categories, "1", `q=${encodeURIComponent(query)}`];
  if (free) parts.push("free=on");
  if (sort) parts.push(`o=${sort}`);
  return `${cfg.baseUrl}/t.json?${parts.join(";")}`;
}

export async function searchTorrents(cfg, opts = {}) {
  const categories = opts.categories ?? CATEGORIES[opts.category] ?? CATEGORIES.movX265;
  const url = buildJsonUrl(cfg, {
    categories,
    query: opts.query ?? "",
    free: opts.free,
    sort: opts.sort ?? "seeders",
  });
  try {
    const res = await fetch(url, {
      headers: { Cookie: `uid=${cfg.uid}; pass=${cfg.passkey}` },
      redirect: "manual",
    });
    if (res.status === 302 || res.status === 401) throw new Error("t.json auth redirect");
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("json")) throw new Error("t.json returned non-JSON");
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(mapJsonRow);
  } catch {
    return searchRss(cfg, opts);
  }
}

function mapJsonRow(row) {
  return {
    id: row.t,
    name: row.name,
    category: row.c,
    size: row.size,
    seeders: row.seeders ?? 0,
    leechers: row.leechers ?? 0,
    imdbId: row["imdb-id"] || null,
    uploaded: row.ctime ? new Date(row.ctime * 1000).toISOString() : null,
    parsed: parseReleaseName(row.name),
  };
}

async function searchRss(cfg, opts = {}) {
  const rssUrl = cfg.rssMovX265;
  if (!rssUrl) throw new Error("t.json unavailable and no RSS_MOVX265 configured");
  const res = await fetch(rssUrl);
  if (!res.ok) throw new Error(`RSS failed (${res.status})`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item><title>([^<]*)<\/title><link>[^/]+\/t\/(\d+)<\/link>.*?<description>Category:[^S]*Size:\s*([^<]+)<\/description>/gs)];
  const q = (opts.query ?? "").toLowerCase();
  const rows = items.map((m) => {
    const name = m[1].replace(/&amp;/g, "&");
    const sizeStr = m[3].trim();
    const sizeGb = parseFloat(sizeStr) * (sizeStr.includes("GB") ? 1e9 : 1e6);
    return {
      id: parseInt(m[2], 10),
      name,
      category: 48,
      size: sizeGb,
      seeders: 0,
      leechers: 0,
      imdbId: null,
      uploaded: null,
      parsed: parseReleaseName(name),
      source: "rss",
    };
  });
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.parsed.title.toLowerCase().includes(q))
    : rows;
  return filtered.slice(0, opts.limit ?? 50);
}

export async function downloadTorrent(cfg, torrentId, outputPath) {
  const url = `${cfg.baseUrl}/download.php/${torrentId}/download.torrent?torrent_pass=${cfg.passkey}`;
  const res = await fetch(url, {
    headers: { Cookie: `uid=${cfg.uid}; pass=${cfg.passkey}` },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] !== 0x64) throw new Error("Response is not a .torrent file");
  writeFileSync(outputPath, buf);
  return { path: outputPath, size: buf.length };
}

export async function healthCheck(cfg) {
  const results = { tjson: false, rss: false, download: null, error: null };
  try {
    const rows = await searchTorrents(cfg, { query: "test", categories: [48], limit: 5 });
    results.tjson = rows.length > 0 && rows[0]?.source !== "rss";
    results.rss = rows.some((r) => r.source === "rss") || rows.length > 0;
    results.sampleCount = rows.length;
  } catch (e) {
    results.error = e.message;
  }
  return results;
}

function usage() {
  console.log(`Usage: torrentday.mjs <command> [options]

Commands:
  search <query> [--category movX265] [--json] [--limit N]
  search-imdb <tt1234567> [--category movX265] [--json]
  download <torrent-id> [-o path.torrent]
  parse "<release name>"
  health [--json]
  categories`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const json = rest.includes("--json");
  const args = rest.filter((a) => a !== "--json");

  if (cmd === "categories") {
    console.log(JSON.stringify(CATEGORIES, null, 2));
    return;
  }

  if (cmd === "parse") {
    console.log(JSON.stringify(parseReleaseName(args.join(" ")), null, 2));
    return;
  }

  const cfg = loadTdConfig();

  if (cmd === "health") {
    const h = await healthCheck(cfg);
    if (json) console.log(JSON.stringify(h, null, 2));
    else console.log(h.tjson ? `OK (${h.sampleCount} results in probe)` : `FAIL: ${h.error}`);
    process.exit(h.tjson ? 0 : 1);
  }

  if (cmd === "search" || cmd === "search-imdb") {
    let query = args[0];
    if (!query) { usage(); process.exit(1); }
    if (cmd === "search-imdb" && !query.startsWith("tt")) query = query.replace(/^imdb:/, "");
    let category = "movX265";
    const catIdx = args.indexOf("--category");
    if (catIdx !== -1) category = args[catIdx + 1];
    let limit = 25;
    const limIdx = args.indexOf("--limit");
    if (limIdx !== -1) limit = parseInt(args[limIdx + 1], 10);

    const rows = await searchTorrents(cfg, { query, category, sort: "seeders" });
    rows.sort((a, b) => b.seeders - a.seeders);
    const out = rows.slice(0, limit);
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      for (const r of out) {
        const gb = (r.size / 1e9).toFixed(2);
        console.log(`[${r.id}] ${r.seeders}s | ${gb}GB | ${r.name}`);
      }
      console.log(`--- ${out.length} result(s)`);
    }
    return;
  }

  if (cmd === "download") {
    const id = args[0];
    if (!id) { usage(); process.exit(1); }
    let out = `/tmp/td-${id}.torrent`;
    const oIdx = args.indexOf("-o");
    if (oIdx !== -1) out = args[oIdx + 1];
    const r = await downloadTorrent(cfg, id, out);
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(`Saved ${r.path} (${r.size} bytes)`);
    return;
  }

  usage();
  process.exit(cmd ? 1 : 0);
}

if (process.argv[1]?.endsWith("torrentday.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
