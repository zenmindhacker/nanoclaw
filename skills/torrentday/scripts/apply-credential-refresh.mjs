#!/usr/bin/env node
/** Apply refresh-login JSON to torrentday credentials on cleo host users. */
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function homeForUser(user) {
  if (user === "christina") return "/home/christina";
  if (user === "cian") return "/home/cian";
  return homedir();
}

function credPath(user) {
  return join(homeForUser(user), ".config/nanoclaw/credentials/services/torrentday");
}

function updateCredFile(filePath, updates) {
  let lines = [];
  try {
    lines = readFileSync(filePath, "utf8").split("\n");
  } catch {
    console.error(`Cannot read ${filePath}`);
    process.exit(1);
  }
  const keys = new Set(Object.keys(updates));
  const kept = lines.filter((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return true;
    const i = t.indexOf("=");
    if (i === -1) return true;
    return !keys.has(t.slice(0, i).trim());
  });
  for (const [k, v] of Object.entries(updates)) {
    if (v) kept.push(`${k}=${v}`);
  }
  writeFileSync(filePath, kept.filter(Boolean).join("\n") + "\n");
}

function parseArgs(argv) {
  let user = null;
  let file = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--user") user = argv[++i];
    else if (argv[i] === "--file") file = argv[++i];
  }
  return { user, file };
}

function main() {
  const { user, file } = parseArgs(process.argv);
  if (!user) {
    console.error("Usage: apply-credential-refresh.mjs --user cian|christina --file refresh.json");
    process.exit(1);
  }

  let payload;
  if (file) {
    payload = JSON.parse(readFileSync(file, "utf8"));
  } else {
    const raw = readFileSync(0, "utf8");
    payload = JSON.parse(raw);
  }

  const updates = {};
  if (payload.passkey) updates.PASSKEY = payload.passkey;
  if (payload.uid) updates.UID = payload.uid;
  if (payload.rssMovX265) updates.RSS_MOVX265 = payload.rssMovX265;

  if (!Object.keys(updates).length) {
    console.error("No credential fields in payload");
    process.exit(1);
  }

  const path = credPath(user);
  updateCredFile(path, updates);
  console.log(JSON.stringify({ ok: true, user, path, updated: Object.keys(updates) }));
}

main();
