#!/usr/bin/env node
/** Browserbase wrapper for TorrentDay login + browse. */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";
import Browserbase from "@browserbasehq/sdk";
import { loadTdConfig } from "./torrentday.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadBbConfig() {
  const cfg = {};
  for (const p of [
    "/workspace/extra/credentials/browserbase",
    join(process.env.HOME || "", ".config/nanoclaw/credentials/services/browserbase"),
    join(__dirname, "..", "credentials.browserbase"),
  ]) {
    try {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i === -1) continue;
        cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
      }
      if (cfg.API_KEY) break;
    } catch {}
  }
  if (!cfg.API_KEY) throw new Error("Missing browserbase credentials");
  return cfg;
}

async function withBrowser(fn, { persist = true } = {}) {
  const bbCfg = loadBbConfig();
  const tdCfg = loadTdConfig();
  const bb = new Browserbase({ apiKey: bbCfg.API_KEY });
  const sessionOpts = {
    projectId: bbCfg.PROJECT_ID,
    browserSettings: {
      solveCaptchas: true,
      recordSession: true,
    },
  };
  if (persist && bbCfg.CONTEXT_ID) {
    sessionOpts.browserSettings.context = { id: bbCfg.CONTEXT_ID, persist: true };
  }
  const session = await bb.sessions.create(sessionOpts);
  const browser = await chromium.connectOverCDP(session.connectUrl);
  const context = browser.contexts()[0] ?? await browser.newContext();
  const page = context.pages()[0] ?? await context.newPage();
  try {
    return await fn({ page, context, session, tdCfg, bb });
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function ensureLoggedIn(page, tdCfg) {
  await page.goto("https://www.torrentday.com/t", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const title = await page.title();
  if (/Member Access|Login/i.test(title)) {
    await page.goto("https://torrentday.com/login.php", { waitUntil: "domcontentloaded" });
    await page.fill("#username", tdCfg.username);
    await page.fill("#password", tdCfg.password);
    await page.waitForTimeout(8000);
    await page.locator('input[type="submit"]').click();
    await page.waitForLoadState("domcontentloaded", { timeout: 60000 });
    await page.waitForTimeout(2000);
  }
  const after = await page.title();
  if (/Member Access|Login/i.test(after)) {
    throw new Error("Login failed — Turnstile may need Developer plan or manual re-auth");
  }
}

async function scrapeSearchPage(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const hasTable = (await page.locator("#torrentTable").count()) > 0;
  if (!hasTable) return { rows: [], loginRequired: /Member Access/i.test(await page.title()) };
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#torrentTable tr")].slice(1).map((r) => ({
      name: r.querySelector(".torrentNameInfo a")?.textContent?.trim(),
      seeds: parseInt(r.querySelector(".seedersInfo")?.textContent || "0", 10),
      href: r.querySelector("td.ac a")?.getAttribute("href"),
    })).filter((x) => x.name)
  );
  return {
    rows: rows.map((r) => {
      const m = r.href?.match(/download\.php\/(\d+)/);
      return { ...r, id: m ? parseInt(m[1], 10) : null };
    }),
  };
}

export async function browseMovies(opts = {}) {
  return withBrowser(async ({ page, tdCfg }) => {
    await ensureLoggedIn(page, tdCfg);
    let url = "https://www.torrentday.com/movies";
    if (opts.decade === "1980s") url = "https://www.torrentday.com/t?48=1&cata=yes";
    if (opts.query) url = `https://www.torrentday.com/t?48=1&q=${encodeURIComponent(opts.query)}&cata=yes`;
    const data = await scrapeSearchPage(page, url);
    if (data.loginRequired) throw new Error("Session expired");
    let rows = data.rows.sort((a, b) => b.seeds - a.seeds);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  });
}

export async function browserHealth() {
  return withBrowser(async ({ page, tdCfg, session }) => {
    await ensureLoggedIn(page, tdCfg);
    const data = await scrapeSearchPage(page, "https://www.torrentday.com/t?48=1&q=test&cata=yes");
    return {
      ok: !data.loginRequired && data.rows.length >= 0,
      sessionId: session.id,
      replay: `https://browserbase.com/sessions/${session.id}`,
      rowCount: data.rows.length,
    };
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const json = rest.includes("--json");
  const args = rest.filter((a) => a !== "--json");

  if (cmd === "health") {
    const h = await browserHealth();
    if (json) console.log(JSON.stringify(h, null, 2));
    else console.log(h.ok ? `OK (session ${h.sessionId})` : "FAIL");
    return;
  }

  if (cmd === "refresh-login") {
    const h = await browserHealth();
    console.log(json ? JSON.stringify({ ok: true, ...h }, null, 2) : `Login OK — ${h.replay}`);
    return;
  }

  if (cmd === "browse") {
    const type = args[0] || "movies";
    let decade = null;
    let query = null;
    let limit = 25;
    const dIdx = args.indexOf("--decade");
    if (dIdx !== -1) decade = args[dIdx + 1];
    const qIdx = args.indexOf("--query");
    if (qIdx !== -1) query = args[qIdx + 1];
    const lIdx = args.indexOf("--limit");
    if (lIdx !== -1) limit = parseInt(args[lIdx + 1], 10);
    const rows = await browseMovies({ decade, query, limit });
    if (json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`[${r.id}] ${r.seeds}s | ${r.name}`);
    return;
  }

  console.log(`Usage: browserbase.mjs <health|refresh-login|browse movies> [--json]`);
  process.exit(1);
}

if (process.argv[1]?.endsWith("browserbase.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
