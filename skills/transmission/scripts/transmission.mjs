#!/usr/bin/env node
/** Transmission RPC CLI for Remembrall (cleo → tailnet). */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  const paths = [
    join(__dirname, "..", "credentials"),
    "/workspace/extra/skills/transmission/credentials",
  ];
  let raw = "";
  for (const p of paths) {
    try {
      raw = readFileSync(p, "utf8");
      break;
    } catch {}
  }
  if (!raw) {
    console.error("Missing credentials. Expected skills/transmission/credentials");
    process.exit(1);
  }
  const cfg = { HOST: "100.82.7.74", PORT: "9091", USER: "torrent", PASS: "torrent", RPC_PATH: "/transmission/rpc" };
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return cfg;
}

function authHeader(cfg) {
  return "Basic " + Buffer.from(`${cfg.USER}:${cfg.PASS}`).toString("base64");
}

function rpcUrl(cfg) {
  return `http://${cfg.HOST}:${cfg.PORT}${cfg.RPC_PATH}`;
}

async function rpc(cfg, method, args = {}, sessionId) {
  const headers = {
    Authorization: authHeader(cfg),
    "Content-Type": "application/json",
  };
  if (sessionId) headers["X-Transmission-Session-Id"] = sessionId;

  let res = await fetch(rpcUrl(cfg), {
    method: "POST",
    headers,
    body: JSON.stringify({ method, arguments: args }),
  });

  if (res.status === 409) {
    const sid = res.headers.get("x-transmission-session-id");
    if (!sid) throw new Error("409 without X-Transmission-Session-Id");
    headers["X-Transmission-Session-Id"] = sid;
    res = await fetch(rpcUrl(cfg), {
      method: "POST",
      headers,
      body: JSON.stringify({ method, arguments: args }),
    });
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RPC ${method} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

const STATUS = { 0: "stopped", 1: "check", 2: "check-wait", 3: "check-done", 4: "downloading", 5: "seed-wait", 6: "seeding" };

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fmtPct(p) {
  return `${Math.round((p || 0) * 100)}%`;
}

async function cmdList(cfg, json) {
  const data = await rpc(cfg, "torrent-get", {
    fields: ["id", "name", "status", "percentDone", "rateDownload", "rateUpload", "eta", "downloadDir", "errorString"],
  });
  const torrents = data.arguments?.torrents || [];
  if (json) {
    console.log(JSON.stringify(torrents, null, 2));
    return;
  }
  if (!torrents.length) {
    console.log("No torrents.");
    return;
  }
  for (const t of torrents) {
    const err = t.errorString ? ` ERR:${t.errorString}` : "";
    console.log(`[${t.id}] ${fmtPct(t.percentDone)} ${STATUS[t.status] || t.status} ↓${fmtBytes(t.rateDownload)}/s ${t.name}${err}`);
  }
  console.log(`--- ${torrents.length} torrent(s)`);
}

async function cmdAdd(cfg, target) {
  const args = target.startsWith("magnet:") ? { filename: target } : { filename: target };
  const data = await rpc(cfg, "torrent-add", args);
  const added = data.arguments?.["torrent-added"] || data.arguments?.["torrent-duplicate"];
  if (added?.name) console.log(`Added: ${added.name} (id ${added.id})`);
  else console.log(JSON.stringify(data.arguments, null, 2));
}

async function cmdSession(cfg, json) {
  const data = await rpc(cfg, "session-get");
  if (json) console.log(JSON.stringify(data.arguments, null, 2));
  else {
    const s = data.arguments || {};
    console.log(`download-dir: ${s["download-dir"]}`);
    console.log(`free-space: ${fmtBytes(s["download-dir-free-space"])}`);
    console.log(`version: ${s.version}`);
  }
}

async function cmdAction(cfg, method, ids, extra = {}) {
  if (!ids.length) {
    console.error("Need torrent id(s)");
    process.exit(1);
  }
  await rpc(cfg, method, { ids: ids.map(Number), ...extra });
  console.log(`${method}: ${ids.join(", ")}`);
}

function usage() {
  console.log(`Usage: transmission.mjs <command> [args]

Commands:
  list [--json]              List all torrents
  session [--json]           Session info (download dir, free space)
  add <magnet-or-url>        Add torrent
  pause <id> [id...]         Pause torrent(s)
  resume <id> [id...]        Resume torrent(s)
  remove <id> [id...]        Remove torrent(s) (keeps data)
  purge <id> [id...]         Remove torrent(s) and delete data

Host: 100.82.7.74:9091 (Remembrall over Tailscale). Use IP, not hostname.`);
}

async function main() {
  const cfg = loadConfig();
  const [cmd, ...rest] = process.argv.slice(2);
  const json = rest.includes("--json");
  const args = rest.filter((a) => a !== "--json");

  switch (cmd) {
    case "list":
      return cmdList(cfg, json);
    case "session":
      return cmdSession(cfg, json);
    case "add":
      if (!args[0]) { usage(); process.exit(1); }
      return cmdAdd(cfg, args[0]);
    case "pause":
      return cmdAction(cfg, "torrent-stop", args);
    case "resume":
      return cmdAction(cfg, "torrent-start", args);
    case "remove":
      return cmdAction(cfg, "torrent-remove", args);
    case "purge":
      return cmdAction(cfg, "torrent-remove", args, { "delete-local-data": true });
    default:
      usage();
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
