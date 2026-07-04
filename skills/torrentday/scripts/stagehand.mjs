#!/usr/bin/env node
/** Local Stagehand wrapper for TorrentDay login + browse. */
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Stagehand } from "@browserbasehq/stagehand";
import { loadTdConfig, parseReleaseName, resolveCategories } from "./torrentday.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, "..");
const GROUP_DIR = "/workspace/group";
const AGENT_DIR = "/workspace/agent";
const TD_STORAGE_STATE = "torrentday-storage-state.json";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCredFile(paths, requiredKey = null) {
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
      if (!requiredKey || cfg[requiredKey]) return cfg;
    } catch {}
  }
  return cfg;
}

function groupDir() {
  if (existsSync(AGENT_DIR)) return AGENT_DIR;
  if (existsSync(GROUP_DIR)) return GROUP_DIR;

  const home = process.env.HOME || "";
  const fallback = home.includes("christina")
    ? join(home, "nanoclaw/agents/silas/groups/dm-with-christina")
    : join(home, "nanoclaw/agents/cleo/groups/dm-with-cian");

  for (const p of [fallback, join(SKILL_DIR, "data")]) {
    try {
      mkdirSync(p, { recursive: true });
      return p;
    } catch {}
  }
  return "/tmp";
}

function storageStatePath() {
  return join(groupDir(), TD_STORAGE_STATE);
}

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

function loadStagehandConfig() {
  return parseCredFile(
    [
      "/workspace/extra/credentials/stagehand",
      join(process.env.HOME || "", ".config/nanoclaw/credentials/services/stagehand"),
      join(SKILL_DIR, "credentials.stagehand"),
    ],
    "ANTHROPIC_API_KEY",
  );
}

function loadCaptchaConfig() {
  return parseCredFile(
    [
      "/workspace/extra/credentials/captcha-solver",
      join(process.env.HOME || "", ".config/nanoclaw/credentials/services/captcha-solver"),
      join(SKILL_DIR, "credentials.captcha-solver"),
    ],
    "API_KEY",
  );
}

function detectBrowserExecutable() {
  const home = process.env.HOME || "";
  const playwrightCache = join(home, ".cache/ms-playwright");

  for (const candidate of [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.AGENT_BROWSER_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/homebrew/bin/chromium",
  ]) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }

  try {
    const dirs = readdirSync(playwrightCache)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const candidate of [
        join(playwrightCache, dir, "chrome-linux", "chrome"),
        join(playwrightCache, dir, "chrome-linux64", "chrome"),
        join(playwrightCache, dir, "chrome-headless-shell-linux64", "chrome-headless-shell"),
      ]) {
        try {
          accessSync(candidate, constants.X_OK);
          return candidate;
        } catch {}
      }
    }
  } catch {}

  throw new Error("No Chromium/Chrome executable found for local Stagehand");
}

async function installTurnstileHook(context) {
  await context.addInitScript(() => {
    const state = {
      sitekey: null,
      action: null,
      cData: null,
      chlPageData: null,
      hasCallback: false,
    };
    window.__tdTurnstile = state;
    window.__tdTurnstileCallback = null;

    const capture = (opts = {}) => {
      window.__tdTurnstile = {
        sitekey: opts.sitekey || null,
        action: opts.action || null,
        cData: opts.cData || null,
        chlPageData: opts.chlPageData || null,
        hasCallback: typeof opts.callback === "function",
      };
      if (typeof opts.callback === "function") {
        window.__tdTurnstileCallback = opts.callback;
      }
    };

    const wrapTurnstile = () => {
      if (!window.turnstile || window.turnstile.__tdWrapped) return;
      const originalRender = window.turnstile.render?.bind(window.turnstile);
      if (typeof originalRender !== "function") return;

      window.turnstile.render = (container, opts = {}) => {
        capture(opts);
        return originalRender(container, opts);
      };
      window.turnstile.__tdWrapped = true;
    };

    wrapTurnstile();
    const timer = setInterval(wrapTurnstile, 50);
    setTimeout(() => clearInterval(timer), 15000);
  });
}

function buildStagehandOptions() {
  const cfg = loadStagehandConfig();
  const home = process.env.HOME || "/tmp";
  const opts = {
    env: "LOCAL",
    localBrowserLaunchOptions: {
      executablePath: detectBrowserExecutable(),
      headless: true,
      acceptDownloads: true,
      chromiumSandbox: false,
      userDataDir: join(home, ".cache/nanoclaw-stagehand", "torrentday"),
      viewport: { width: 1288, height: 798 },
    },
    verbose: 0,
    disablePino: true,
  };

  if (cfg.ANTHROPIC_API_KEY) {
    opts.model = {
      modelName: "anthropic/claude-sonnet-4-6",
      apiKey: cfg.ANTHROPIC_API_KEY,
      thinkingEffort: "low",
    };
  }

  return opts;
}

function loadStoredState() {
  return loadJson(storageStatePath(), { cookies: [], origins: {}, lastUrl: null });
}

async function restoreStoredState(context, state) {
  if (Array.isArray(state.cookies) && state.cookies.length) {
    await context.addCookies(
      state.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      })),
    );
  }

  await context.addInitScript((origins) => {
    try {
      const current = origins?.[window.location.origin];
      if (!current || typeof current !== "object") return;
      for (const [key, value] of Object.entries(current)) {
        window.localStorage.setItem(key, value);
      }
    } catch {}
  }, state.origins || {});
}

async function persistStoredState(context, page) {
  const state = loadStoredState();
  state.cookies = await context.cookies();
  state.lastUrl = page.url();

  const origin = (() => {
    try {
      return new URL(page.url()).origin;
    } catch {
      return null;
    }
  })();

  if (origin) {
    state.origins ||= {};
    state.origins[origin] = await page.mainFrame().evaluate(() => {
      const values = {};
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        values[key] = window.localStorage.getItem(key) ?? "";
      }
      return values;
    });
  }

  saveJson(storageStatePath(), state);
}

async function withBrowser(fn) {
  const tdCfg = loadTdConfig();
  const captchaCfg = loadCaptchaConfig();
  const stagehand = new Stagehand(buildStagehandOptions());
  await stagehand.init();

  const context = stagehand.context;
  await installTurnstileHook(context);
  await restoreStoredState(context, loadStoredState());

  const page = context.activePage() || context.pages()[0] || (await context.newPage());

  try {
    return await fn({ page, context, stagehand, tdCfg, captchaCfg });
  } finally {
    try {
      await persistStoredState(context, page);
    } catch {}
    await stagehand.close({ force: true }).catch(() => {});
  }
}

function isLoginTitle(title) {
  return /Member Access|Login/i.test(title || "");
}

async function waitForDom(page, timeoutMs = 60000) {
  await page.mainFrame().waitForLoadState("domcontentloaded", timeoutMs);
}

async function gotoWithTolerance(page, url, timeoutMs = 60000) {
  try {
    return await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeoutMs,
    });
  } catch (error) {
    if (!/waitForLoadState\(domcontentloaded\) timed out/i.test(String(error?.message || error))) {
      throw error;
    }
    await delay(3000);
    return null;
  }
}

async function getTurnstileData(page) {
  return page.mainFrame().evaluate(() => {
    const widget = document.querySelector("[data-sitekey]");
    const state = window.__tdTurnstile || {};
    const html = document.documentElement?.innerHTML || "";
    const regexSitekey =
      html.match(/data-sitekey=["']([^"']+)["']/i)?.[1] ||
      html.match(/sitekey["'\s:=]+(0x[0-9A-Za-z_-]+)/i)?.[1] ||
      null;
    return {
      sitekey: state.sitekey || widget?.getAttribute("data-sitekey") || regexSitekey,
      action: state.action || widget?.getAttribute("data-action") || null,
      cData: state.cData || widget?.getAttribute("data-cdata") || null,
      chlPageData: state.chlPageData || null,
      hasCallback: Boolean(state.hasCallback && typeof window.__tdTurnstileCallback === "function"),
      pageurl: window.location.href,
      userAgent: navigator.userAgent,
    };
  });
}

async function waitForTurnstileData(page, timeoutMs = 20000, { forceWait = false } = {}) {
  const deadline = Date.now() + timeoutMs;
  let latest = await getTurnstileData(page);

  while (Date.now() < deadline) {
    if (latest.sitekey) return latest;

    const text = await page.mainFrame().evaluate(() =>
      (document.body?.innerText || "").slice(0, 1200),
    );
    if (!forceWait && !/turnstile|verify you are human|just a moment|checking your browser|security check/i.test(text)) {
      return latest;
    }

    await delay(1000);
    latest = await getTurnstileData(page);
  }

  return latest;
}

async function create2CaptchaTask(apiKey, details) {
  const response = await fetch("https://api.2captcha.com/createTask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: "TurnstileTaskProxyless",
        websiteURL: details.pageurl,
        websiteKey: details.sitekey,
        action: details.action || undefined,
        data: details.cData || undefined,
        pagedata: details.chlPageData || undefined,
        userAgent: details.userAgent || undefined,
      },
    }),
  });

  const body = await response.json();
  if (!response.ok || body.errorId) {
    throw new Error(body.errorDescription || `2Captcha createTask failed (${response.status})`);
  }
  return body.taskId;
}

async function poll2CaptchaResult(apiKey, taskId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(3000);
    const response = await fetch("https://api.2captcha.com/getTaskResult", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientKey: apiKey,
        taskId,
      }),
    });

    const body = await response.json();
    if (!response.ok || body.errorId) {
      throw new Error(body.errorDescription || `2Captcha getTaskResult failed (${response.status})`);
    }
    if (body.status === "processing") continue;
    if (body.status === "ready" && body.solution?.token) {
      return {
        token: body.solution.token,
        userAgent: body.solution.userAgent || body.userAgent || null,
      };
    }
    throw new Error("2Captcha returned no Turnstile token");
  }
  throw new Error("Timed out waiting for 2Captcha Turnstile solve");
}

async function solveTurnstileIfPresent(page, captchaCfg, options = {}) {
  const turnstile = await waitForTurnstileData(
    page,
    options.timeoutMs ?? 20000,
    { forceWait: options.forceWait ?? false },
  );
  if (!turnstile.sitekey) return false;
  if (!captchaCfg.API_KEY) {
    throw new Error("Turnstile detected but captcha-solver credentials are missing");
  }

  const taskId = await create2CaptchaTask(captchaCfg.API_KEY, turnstile);
  const result = await poll2CaptchaResult(captchaCfg.API_KEY, taskId);

  await page.mainFrame().evaluate((value) => {
    const form = document.querySelector("form") || document.body;
    let input = document.querySelector('input[name="cf-turnstile-response"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "cf-turnstile-response";
      form.appendChild(input);
    }
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    if (typeof window.__tdTurnstileCallback === "function") {
      window.__tdTurnstileCallback(value);
    }
  }, result.token);

  return true;
}

async function ensureLoggedIn(page, tdCfg, captchaCfg) {
  await gotoWithTolerance(page, "https://www.torrentday.com/t");
  await delay(2000);

  if (!isLoginTitle(await page.title())) return;
  if (!tdCfg.username || !tdCfg.password) {
    throw new Error("TorrentDay login requires USERNAME and PASSWORD when the saved session is stale");
  }

  await gotoWithTolerance(page, "https://torrentday.com/login.php");
  await page.locator("#username").fill(tdCfg.username);
  await page.locator("#password").fill(tdCfg.password);
  await delay(1000);
  await solveTurnstileIfPresent(page, captchaCfg, { forceWait: true, timeoutMs: 12000 });
  await page.locator('input[type="submit"]').click();
  await waitForDom(page, 60000).catch(() => {});
  await delay(3000);

  if (await solveTurnstileIfPresent(page, captchaCfg)) {
    await delay(2000);
    const submit = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await submit.count()) {
      await submit.click().catch(() => {});
      await delay(3000);
    }
  }

  await gotoWithTolerance(page, "https://www.torrentday.com/t");
  await delay(2000);

  if (isLoginTitle(await page.title())) {
    throw new Error("Login failed — Turnstile solve or manual re-auth required");
  }
}

async function scrapeSearchPage(page, url) {
  await gotoWithTolerance(page, url);
  await delay(2500);
  const hasTable = (await page.locator("#torrentTable").count()) > 0;
  if (!hasTable) return { rows: [], loginRequired: isLoginTitle(await page.title()) };

  const rows = await page.mainFrame().evaluate(() =>
    [...document.querySelectorAll("#torrentTable tr")]
      .slice(1)
      .map((r) => ({
        name: r.querySelector(".torrentNameInfo a")?.textContent?.trim(),
        seeds: parseInt(r.querySelector(".seedersInfo")?.textContent || "0", 10),
        href: r.querySelector("td.ac a")?.getAttribute("href"),
      }))
      .filter((x) => x.name),
  );

  return {
    rows: rows.map((r) => {
      const m = r.href?.match(/download\.php\/(\d+)/);
      return { ...r, id: m ? parseInt(m[1], 10) : null };
    }),
  };
}

function decadeRange(decade) {
  const m = String(decade || "").match(/(\d{4})s/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  return { start, end: start + 9, label: `${start}s` };
}

function categoryUrl(query, categoryIds = [48]) {
  if (!categoryIds.length) {
    const q = query ? `q=${encodeURIComponent(query)}&cata=yes` : "";
    return `https://www.torrentday.com/t?${q}`;
  }
  const catPart = categoryIds.map((id) => `${id}=1`).join("&");
  const q = query ? `&q=${encodeURIComponent(query)}&cata=yes` : "";
  return `https://www.torrentday.com/t?${catPart}${q}`;
}

async function browseDecade(page, decade, limit = 40, categoryIds = [48]) {
  const range = decadeRange(decade);
  if (!range) throw new Error(`Unknown decade: ${decade}`);

  const byId = new Map();
  for (let year = range.start; year <= range.end; year += 1) {
    const data = await scrapeSearchPage(page, categoryUrl(String(year), categoryIds));
    if (data.loginRequired) throw new Error("Session expired");

    for (const row of data.rows) {
      if (!row.id || byId.has(row.id)) continue;
      const parsedYear = parseReleaseName(row.name).year;
      if (parsedYear && (parsedYear < range.start || parsedYear > range.end)) continue;
      byId.set(row.id, row);
    }
    if (byId.size >= limit * 2) break;
  }

  return [...byId.values()].sort((a, b) => b.seeds - a.seeds).slice(0, limit);
}

export async function browseMovies(opts = {}) {
  const categoryIds =
    opts.categoryIds ??
    (opts.category != null ? resolveCategories(opts.category) : resolveCategories("movX265"));

  return withBrowser(async ({ page, tdCfg, captchaCfg }) => {
    await ensureLoggedIn(page, tdCfg, captchaCfg);

    if (opts.decade) {
      return browseDecade(page, opts.decade, opts.limit ?? 40, categoryIds);
    }

    const data = await scrapeSearchPage(
      page,
      categoryUrl(opts.query || "", categoryIds.length ? categoryIds : [48]),
    );
    if (data.loginRequired) throw new Error("Session expired");

    let rows = data.rows.sort((a, b) => b.seeds - a.seeds);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  });
}

async function scrapeProfileCredentials(page, context) {
  await gotoWithTolerance(page, "https://www.torrentday.com/user.php");
  await delay(2500);

  const scraped = await page.mainFrame().evaluate(() => {
    const html = document.documentElement.innerHTML;
    const passkey =
      html.match(/torrent_pass=([a-f0-9]{32})/i)?.[1] ||
      html.match(/passkey=([a-f0-9]{32})/i)?.[1] ||
      null;
    const rssHref =
      [...document.querySelectorAll("a[href*='rss'], input[value*='rss']")]
        .map((el) => el.getAttribute("href") || el.getAttribute("value"))
        .find((h) => h && /rss/i.test(h)) || null;
    const rssFromHtml = html
      .match(/(https:\/\/[^"'\s<>]+rss[^"'\s<>]*)/i)?.[1]
      ?.replace(/&amp;/g, "&");
    return { passkey, rss: rssHref || rssFromHtml || null };
  });

  const cookies = await context.cookies("https://www.torrentday.com");
  const uid = cookies.find((cookie) => cookie.name === "uid")?.value || null;
  const pass = cookies.find((cookie) => cookie.name === "pass")?.value || null;
  const rssAbsolute =
    scraped.rss && /^https?:\/\//i.test(scraped.rss)
      ? scraped.rss
      : scraped.rss
        ? `https://www.torrentday.com${scraped.rss}`
        : null;

  return {
    passkey: scraped.passkey || pass,
    uid,
    rssMovX265: rssAbsolute,
  };
}

const CRED_PATHS = [
  "/workspace/extra/credentials/torrentday",
  join(process.env.HOME || "", ".config/nanoclaw/credentials/services/torrentday"),
  join(__dirname, "..", "credentials"),
];

function findWritableCredPath() {
  for (const p of CRED_PATHS) {
    try {
      accessSync(p, constants.W_OK);
      return p;
    } catch {
      try {
        accessSync(dirname(p), constants.W_OK);
        return p;
      } catch {}
    }
  }
  return null;
}

function updateCredFile(filePath, updates) {
  let lines = [];
  try {
    lines = readFileSync(filePath, "utf8").split("\n");
  } catch {}

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

export async function refreshLoginAndScrape() {
  return withBrowser(async ({ page, context, tdCfg, captchaCfg }) => {
    await ensureLoggedIn(page, tdCfg, captchaCfg);
    const scraped = await scrapeProfileCredentials(page, context);
    const updates = {};
    if (scraped.passkey) updates.PASSKEY = scraped.passkey;
    if (scraped.uid) updates.UID = scraped.uid;
    if (scraped.rssMovX265) updates.RSS_MOVX265 = scraped.rssMovX265;

    const writable = findWritableCredPath();
    if (writable && Object.keys(updates).length) {
      updateCredFile(writable, updates);
      return {
        ok: true,
        hostUpdateRequired: false,
        sessionId: null,
        updated: Object.keys(updates),
        ...scraped,
      };
    }

    return {
      ok: true,
      hostUpdateRequired: true,
      sessionId: null,
      passkey: scraped.passkey,
      uid: scraped.uid,
      rssMovX265: scraped.rssMovX265,
    };
  });
}

export async function browserHealth() {
  return withBrowser(async ({ page, tdCfg, captchaCfg }) => {
    await ensureLoggedIn(page, tdCfg, captchaCfg);
    const data = await scrapeSearchPage(page, "https://www.torrentday.com/t?48=1&q=test&cata=yes");
    return {
      ok: !data.loginRequired && data.rows.length >= 0,
      sessionId: null,
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
    else console.log(h.ok ? "OK (local)" : "FAIL");
    return;
  }

  if (cmd === "refresh-login") {
    const h = await refreshLoginAndScrape();
    if (json) console.log(JSON.stringify(h, null, 2));
    else console.log(h.hostUpdateRequired ? "Login OK — host update required" : "Login OK — credentials updated");
    return;
  }

  if (cmd === "browse") {
    const type = args[0] || "movies";
    if (type !== "movies") throw new Error(`Unsupported browse type: ${type}`);

    let decade = null;
    let query = null;
    let limit = 25;
    const dIdx = args.indexOf("--decade");
    if (dIdx !== -1) decade = args[dIdx + 1];
    const qIdx = args.indexOf("--query");
    if (qIdx !== -1) query = args[qIdx + 1];
    const lIdx = args.indexOf("--limit");
    if (lIdx !== -1) limit = parseInt(args[lIdx + 1], 10);
    let category = "movX265";
    const cIdx = args.indexOf("--category");
    if (cIdx !== -1) category = args[cIdx + 1];

    const rows = await browseMovies({ decade, query, limit, category });
    if (json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`[${r.id}] ${r.seeds}s | ${r.name}`);
    return;
  }

  console.log("Usage: stagehand.mjs <health|refresh-login|browse movies> [--json]");
  process.exit(1);
}

if (process.argv[1]?.endsWith("stagehand.mjs")) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
