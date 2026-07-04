#!/usr/bin/env node
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Stagehand } from "@browserbasehq/stagehand";

const GROUP_DIR = "/workspace/group";
const AGENT_DIR = "/workspace/agent";
const SKILL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE_FILE = "substack-storage-state.json";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCredFile(path) {
  const cfg = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {}
  return cfg;
}

function readSingleCredential(name) {
  for (const path of [
    `/workspace/extra/credentials/${name}`,
    join(process.env.HOME || "", `.config/nanoclaw/credentials/services/${name}`),
    join(SKILL_DIR, name),
  ]) {
    try {
      const value = readFileSync(path, "utf8").trim();
      if (value) return value;
    } catch {}
  }
  return "";
}

function loadStagehandConfig() {
  const paths = [
    "/workspace/extra/credentials/stagehand",
    join(process.env.HOME || "", ".config/nanoclaw/credentials/services/stagehand"),
    join(SKILL_DIR, "credentials.stagehand"),
  ];
  for (const path of paths) {
    const cfg = parseCredFile(path);
    if (cfg.ANTHROPIC_API_KEY) {
      return {
        ANTHROPIC_API_KEY: cfg.ANTHROPIC_API_KEY,
      };
    }
  }
  return {};
}

function getSiteCredentials(site) {
  const username = readSingleCredential(`${site}-username`);
  const password = readSingleCredential(`${site}-password`);
  if (!username || !password) return null;
  return { username, password };
}

function groupDir() {
  if (existsSync(AGENT_DIR)) return AGENT_DIR;
  if (existsSync(GROUP_DIR)) return GROUP_DIR;

  const home = process.env.HOME || "";
  const fallback = home.includes("christina")
    ? join(home, "nanoclaw/agents/silas/groups/dm-with-christina")
    : join(home, "nanoclaw/agents/cleo/groups/dm-with-cian");

  for (const path of [fallback, join(SKILL_DIR, "data")]) {
    try {
      mkdirSync(path, { recursive: true });
      return path;
    } catch {}
  }
  return "/tmp";
}

function statePath() {
  return join(groupDir(), STATE_FILE);
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return { cookies: [], origins: {}, lastUrl: "https://substack.com/" };
  }
}

function saveState(state) {
  mkdirSync(dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
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

function buildStagehandOptions() {
  const cfg = loadStagehandConfig();
  const home = process.env.HOME || "/tmp";
  const options = {
    env: "LOCAL",
    localBrowserLaunchOptions: {
      executablePath: detectBrowserExecutable(),
      headless: true,
      acceptDownloads: true,
      chromiumSandbox: false,
      userDataDir: join(home, ".cache/nanoclaw-stagehand", "substack"),
      viewport: { width: 1288, height: 798 },
    },
    verbose: 0,
    disablePino: true,
  };

  if (cfg.ANTHROPIC_API_KEY) {
    options.model = {
      modelName: "anthropic/claude-sonnet-4-6",
      apiKey: cfg.ANTHROPIC_API_KEY,
      thinkingEffort: "low",
    };
  }

  return options;
}

async function restoreState(context, state) {
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
      if (!current) return;
      for (const [key, value] of Object.entries(current)) {
        window.localStorage.setItem(key, value);
      }
    } catch {}
  }, state.origins || {});
}

async function persistState(context, page) {
  const state = loadState();
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

  saveState(state);
}

async function withBrowser(fn, { restoreLastUrl = false } = {}) {
  const stagehand = new Stagehand(buildStagehandOptions());
  await stagehand.init();

  const context = stagehand.context;
  const state = loadState();
  await restoreState(context, state);
  const page = context.activePage() || context.pages()[0] || (await context.newPage());

  try {
    if (restoreLastUrl && state.lastUrl) {
      await page.goto(state.lastUrl, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
      await delay(1000);
    }
    return await fn({ page, context, state });
  } finally {
    try {
      await persistState(context, page);
    } catch {}
    await stagehand.close({ force: true }).catch(() => {});
  }
}

async function clickElementByText(page, text, selector = "a, button, [role='button']") {
  const clicked = await page.mainFrame().evaluate(({ label, selectorList }) => {
    const items = [...document.querySelectorAll(selectorList)];
    const match = items.find((el) => {
      const content = el.textContent?.trim() || "";
      return content === label || content.includes(label);
    });
    if (!match) return false;
    match.click();
    return true;
  }, { label: text, selectorList: selector });

  if (!clicked) throw new Error(`Element with text "${text}" not found`);
}

async function buttonTextSnapshot(page) {
  return page.mainFrame().evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((button) => button.textContent?.trim() || "")
      .filter(Boolean)
      .slice(0, 20),
  );
}

async function isLoggedIn(page) {
  const buttons = await buttonTextSnapshot(page);
  const hasCreate = buttons.some((text) => text.includes("Create") || text.includes("New post"));
  const hasSignIn = buttons.some((text) => text === "Sign in" || text === "Create account");
  return hasCreate && !hasSignIn;
}

async function ensureLoggedIn(page, creds) {
  await page.goto("https://substack.com/", { waitUntil: "domcontentloaded", timeoutMs: 30000 });
  await delay(2000);
  if (await isLoggedIn(page)) return;

  await page.goto("https://substack.com/sign-in", {
    waitUntil: "domcontentloaded",
    timeoutMs: 30000,
  });
  await delay(1000);
  await page.locator('input[type="email"], input[placeholder*="Email"]').first().fill(creds.username);
  await clickElementByText(page, "Sign in with password");
  await delay(1000);
  await page.locator('input[type="password"]').first().fill(creds.password);
  await clickElementByText(page, "Continue", "button, [role='button']");
  await delay(3000);

  const needs2FA = await page.mainFrame().evaluate(() =>
    document.body.innerText.includes("Two-factor") || document.body.innerText.includes("2FA"),
  );
  if (needs2FA) {
    const error = new Error("2FA required - manual intervention needed");
    error.needs2FA = true;
    throw error;
  }

  await page.goto("https://substack.com/", { waitUntil: "domcontentloaded", timeoutMs: 30000 });
  await delay(2000);
  if (!(await isLoggedIn(page))) {
    throw new Error("Login failed");
  }
}

async function maybeDismissOnboarding(page) {
  const hasOnboarding = await page.mainFrame().evaluate(() =>
    document.body.innerText.includes("Select 3 topics") ||
    document.body.innerText.includes("Select 3 more"),
  );
  if (!hasOnboarding) return;

  await page.mainFrame().evaluate(() => {
    const close = document.querySelector('[aria-label="Close"]');
    if (close) {
      close.click();
      return;
    }
    document.body.click();
  });
  await delay(1000);
}

async function getDebugInfo(page) {
  const url = page.url();
  const buttons = await buttonTextSnapshot(page);
  const inputs = await page.mainFrame().evaluate(() =>
    [...document.querySelectorAll("input")]
      .map((i) => i.type || i.placeholder || "input")
      .slice(0, 8),
  );
  const textSnippets = await page.mainFrame().evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((e) => e.children.length === 0)
      .map((e) => e.textContent?.trim() || "")
      .filter((text) => text.length > 2 && text.length < 40)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 15),
  );
  const screenshot = `/tmp/substack-stagehand-debug-${Date.now()}.png`;
  const buffer = await page.screenshot({ path: screenshot });
  return {
    url,
    buttons,
    inputs,
    textSnippets,
    screenshot,
    screenshotBytes: buffer.length,
  };
}

async function failStep(page, step, error, extra = {}) {
  const debug = await getDebugInfo(page);
  return { ok: false, step, error, debug, ...extra };
}

async function publishNote(page, noteText) {
  await maybeDismissOnboarding(page);
  await clickElementByText(page, "Create", "button, [role='button']");
  await delay(1000);
  await clickElementByText(page, "Note", "button, a, [role='button']");
  await delay(1000);

  const editorFound = await page.mainFrame().evaluate((text) => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!editor) return false;
    editor.focus();
    editor.innerHTML = `<p>${text}</p>`;
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return true;
  }, noteText);

  if (!editorFound) {
    return failStep(page, 5, "Editor not found");
  }

  await delay(500);
  await clickElementByText(page, "Post", "button, [role='button']");
  await delay(3000);
  await page.goto("https://substack.com/profile", {
    waitUntil: "domcontentloaded",
    timeoutMs: 30000,
  });
  await delay(1500);

  const noteUrl = await page.mainFrame().evaluate(() => {
    const link = document.querySelector('a[href*="/note/"]');
    return link?.href || null;
  });

  return {
    ok: true,
    posted: true,
    noteUrl: noteUrl || "Could not retrieve - check profile manually",
    noteText: noteText.slice(0, 50) + (noteText.length > 50 ? "..." : ""),
  };
}

async function cmdOpen(url) {
  return withBrowser(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeoutMs: 30000 });
    await delay(1000);
    return { ok: true, url: page.url() };
  });
}

async function cmdScreenshot(outputPath) {
  return withBrowser(async ({ page }) => {
    const path = outputPath || `/tmp/substack-stagehand-${Date.now()}.png`;
    const buffer = await page.screenshot({ path, fullPage: false });
    return { ok: true, path, bytes: buffer.length };
  }, { restoreLastUrl: true });
}

async function cmdSnapshot() {
  return withBrowser(async ({ page }) => {
    const snapshot = await page.mainFrame().getAccessibilityTree(true);
    return { ok: true, snapshot };
  }, { restoreLastUrl: true });
}

async function cmdClick(selector) {
  return withBrowser(async ({ page }) => {
    try {
      await page.locator(selector).first().click();
      await delay(500);
      return { ok: true, clicked: selector };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }, { restoreLastUrl: true });
}

async function cmdType(selector, text) {
  return withBrowser(async ({ page }) => {
    try {
      await page.locator(selector).first().type(text, { delay: 50 });
      return { ok: true, typed: selector };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }, { restoreLastUrl: true });
}

async function cmdEval(code) {
  return withBrowser(async ({ page }) => {
    try {
      const result = await page.mainFrame().evaluate(code);
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }, { restoreLastUrl: true });
}

async function cmdClose() {
  rmSync(statePath(), { force: true });
  return { ok: true, closed: true };
}

async function cmdLogin(site) {
  if (site !== "substack") {
    return {
      ok: false,
      error: `Unknown site: ${site}. Supported: substack`,
    };
  }

  const creds = getSiteCredentials(site);
  if (!creds) {
    return {
      ok: false,
      error: "Missing credentials: substack-username and substack-password",
    };
  }

  return withBrowser(async ({ page }) => {
    try {
      await ensureLoggedIn(page, creds);
      return { ok: true, loggedIn: site, url: page.url() };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        needs2FA: Boolean(error.needs2FA),
      };
    }
  });
}

async function cmdPostNote(noteText) {
  if (!noteText) {
    return { ok: false, error: 'Usage: post-note "Your note text here"' };
  }

  const creds = getSiteCredentials("substack");
  if (!creds) {
    return {
      ok: false,
      error: "Missing credentials: substack-username and substack-password",
    };
  }

  return withBrowser(async ({ page }) => {
    try {
      await ensureLoggedIn(page, creds);
      return publishNote(page, noteText);
    } catch (error) {
      if (error.needs2FA) {
        return { ok: false, error: error.message, needs2FA: true };
      }
      return failStep(page, "unknown", error.message);
    }
  });
}

const [cmd, ...args] = process.argv.slice(2);

const commands = {
  "post-note": () => cmdPostNote(args.join(" ")),
  open: () => cmdOpen(args[0]),
  screenshot: () => cmdScreenshot(args[0]),
  snapshot: () => cmdSnapshot(),
  click: () => cmdClick(args[0]),
  type: () => cmdType(args[0], args.slice(1).join(" ")),
  eval: () => cmdEval(args.join(" ")),
  login: () => cmdLogin(args[0]),
  close: () => cmdClose(),
};

if (!cmd || !commands[cmd]) {
  console.error(`Usage: stagehand.mjs <command> [args]

Commands:
  post-note <text>        Post a Substack note

  # Atomic commands (for debugging/recovery):
  login substack          Auto-login
  open <url>              Navigate to URL
  screenshot [path]       Take screenshot
  snapshot                Get accessibility tree
  click <selector>        Click element
  type <selector> <text>  Type into element
  eval <code>             Run JavaScript in page
  close                   Clear persisted browser state`);
  process.exit(1);
}

commands[cmd]()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    console.log(JSON.stringify({ ok: false, error: error.message || String(error) }));
    process.exit(1);
  });
