#!/usr/bin/env node
import puppeteer from '/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';

const BROWSERLESS_API = 'https://production-sfo.browserless.io';
const SESSION_FILE = '/workspace/group/browserless-session.json';

function readCredential(name) {
  const path = `/workspace/extra/credentials/${name}`;
  return readFileSync(path, 'utf8').trim();
}

function getSiteCredentials(site) {
  try {
    return {
      username: readCredential(`${site}-username`),
      password: readCredential(`${site}-password`)
    };
  } catch (e) {
    return null;
  }
}

const LOGIN_FLOWS = {
  substack: {
    url: 'https://substack.com/sign-in',
    steps: [
      { action: 'fill', selector: 'input[type="email"]', field: 'username' },
      { action: 'clickText', text: 'Sign in with password' },
      { action: 'wait', ms: 1000 },
      { action: 'fill', selector: 'input[type="password"]', field: 'password' },
      { action: 'clickText', text: 'Continue' },
      { action: 'wait', ms: 3000 },
    ],
  },
};

function loadSession() {
  if (existsSync(SESSION_FILE)) {
    try {
      const data = JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      if (Date.now() < data.expiresAt) {
        return data;
      }
      // Session expired, clean up
      clearSession();
    } catch {}
  }
  return null;
}

function saveSession(data) {
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
}

function clearSession() {
  if (existsSync(SESSION_FILE)) unlinkSync(SESSION_FILE);
}

async function createSession() {
  const token = readCredential('browserless');
  const response = await fetch(`${BROWSERLESS_API}/session?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ttl: 86400000,           // 24 hours (max for free tier)
      processKeepAlive: 30000, // Keep browser alive 30s after disconnect
      stealth: true,
      headless: true,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status} ${await response.text()}`);
  }
  
  const session = await response.json();
  const sessionData = {
    connect: session.connect,
    stop: session.stop,
    expiresAt: Date.now() + 86400000, // 24 hours
    createdAt: Date.now(),
  };
  saveSession(sessionData);
  return sessionData;
}

async function getOrCreateBrowser() {
  let session = loadSession();
  
  if (session) {
    try {
      const browser = await puppeteer.connect({ browserWSEndpoint: session.connect });
      const pages = await browser.pages();
      const page = pages[0] || await browser.newPage();
      return { browser, page, session, reused: true };
    } catch (e) {
      // Session might be dead, try to create new one
      clearSession();
    }
  }
  
  session = await createSession();
  const browser = await puppeteer.connect({ browserWSEndpoint: session.connect });
  const page = await browser.newPage();
  return { browser, page, session, reused: false };
}

async function cmdOpen(url) {
  const { browser, page, reused } = await getOrCreateBrowser();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1000));
  console.log(JSON.stringify({ ok: true, url: page.url(), reused }));
  await browser.disconnect();
}

async function cmdScreenshot(outputPath) {
  const { browser, page } = await getOrCreateBrowser();
  const path = outputPath || join(tmpdir(), `browserless-${Date.now()}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(JSON.stringify({ ok: true, path }));
  await browser.disconnect();
}

async function cmdSnapshot() {
  const { browser, page } = await getOrCreateBrowser();
  const snapshot = await page.accessibility.snapshot({ interestingOnly: true });
  
  function simplify(node, refs = { count: 0 }) {
    if (!node) return null;
    const ref = `e${refs.count++}`;
    const result = { ref, role: node.role, name: node.name };
    if (node.value) result.value = node.value;
    if (node.checked !== undefined) result.checked = node.checked;
    if (node.disabled) result.disabled = true;
    if (node.children?.length) {
      result.children = node.children.map(c => simplify(c, refs)).filter(Boolean);
    }
    return result;
  }
  
  const simplified = simplify(snapshot);
  console.log(JSON.stringify({ ok: true, snapshot: simplified }));
  await browser.disconnect();
}

async function cmdClick(selector) {
  const { browser, page } = await getOrCreateBrowser();
  try {
    await page.click(selector, { timeout: 5000 });
    await new Promise(r => setTimeout(r, 500));
    console.log(JSON.stringify({ ok: true, clicked: selector }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
  }
  await browser.disconnect();
}

async function cmdType(selector, text) {
  const { browser, page } = await getOrCreateBrowser();
  try {
    await page.type(selector, text, { delay: 50 });
    console.log(JSON.stringify({ ok: true, typed: selector }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
  }
  await browser.disconnect();
}

async function cmdEval(code) {
  const { browser, page } = await getOrCreateBrowser();
  try {
    const result = await page.evaluate(code);
    console.log(JSON.stringify({ ok: true, result }));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
  }
  await browser.disconnect();
}

async function cmdClose() {
  const session = loadSession();
  if (session?.stop) {
    try {
      await fetch(`${session.stop}&force=true`, { method: 'DELETE' });
    } catch {}
  }
  clearSession();
  console.log(JSON.stringify({ ok: true, closed: true }));
}

async function cmdLogin(site) {
  const flow = LOGIN_FLOWS[site];
  if (!flow) {
    console.log(JSON.stringify({ ok: false, error: `Unknown site: ${site}. Supported: ${Object.keys(LOGIN_FLOWS).join(', ')}` }));
    return;
  }
  
  const creds = getSiteCredentials(site);
  if (!creds) {
    console.log(JSON.stringify({ ok: false, error: `Missing credentials: /workspace/extra/credentials/${site}-username and ${site}-password` }));
    return;
  }
  
  const { browser, page } = await getOrCreateBrowser();
  
  try {
    await page.goto(flow.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    
    for (const step of flow.steps) {
      switch (step.action) {
        case 'fill':
          const value = step.field === 'username' ? creds.username : creds.password;
          await page.waitForSelector(step.selector, { timeout: 5000 });
          await page.type(step.selector, value, { delay: 30 });
          break;
        case 'click':
          await page.waitForSelector(step.selector, { timeout: 5000 });
          await page.click(step.selector);
          break;
        case 'clickText':
          await page.evaluate((text) => {
            const el = [...document.querySelectorAll('a, button, [role="button"]')]
              .find(e => e.textContent.includes(text));
            if (el) el.click();
            else throw new Error(`Element with text "${text}" not found`);
          }, step.text);
          break;
        case 'wait':
          await new Promise(r => setTimeout(r, step.ms));
          break;
      }
    }
    
    // Check for 2FA
    const has2FA = await page.$('text=Two-factor authentication') || await page.$('text=2FA');
    if (has2FA) {
      console.log(JSON.stringify({ ok: false, error: '2FA required - manual intervention needed', needs2FA: true }));
      await browser.disconnect();
      return;
    }
    
    // Verify success by navigating to home
    await page.goto('https://substack.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    // Check for logged-in indicators via page content
    const isLoggedIn = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Create') || text.includes('New post') || text.includes('Profile');
    });
    
    if (isLoggedIn) {
      console.log(JSON.stringify({ ok: true, loggedIn: site, url: page.url() }));
    } else {
      console.log(JSON.stringify({ ok: false, error: 'Login may have failed - success indicator not found' }));
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message }));
  }
  
  await browser.disconnect();
}

async function cmdPostNote(noteText) {
  if (!noteText) {
    console.log(JSON.stringify({ ok: false, error: 'Usage: post-note "Your note text here"' }));
    return;
  }

  const creds = getSiteCredentials('substack');
  if (!creds) {
    console.log(JSON.stringify({ ok: false, error: 'Missing credentials: /workspace/extra/credentials/substack-username and substack-password' }));
    return;
  }

  // Reuse existing session or create new one
  let session = loadSession();
  
  if (!session) {
    const token = readCredential('browserless');
    const response = await fetch(`${BROWSERLESS_API}/session?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ttl: 86400000,  // 24 hours (free tier max)
        stealth: true,
        headless: false,
      }),
    });
    
    if (!response.ok) {
      console.log(JSON.stringify({ ok: false, error: `Failed to create session: ${response.status}` }));
      return;
    }
    
    const newSession = await response.json();
    session = {
      connect: newSession.connect,
      stop: newSession.stop,
      expiresAt: Date.now() + 86400000,
      createdAt: Date.now(),
    };
    saveSession(session);
    console.error('Created new Browserless session (24h TTL)');
  } else {
    console.error('Reusing existing Browserless session');
  }
  
  const browser = await puppeteer.connect({ browserWSEndpoint: session.connect });
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // Helper: get debug info for any step failure
  async function getDebugInfo() {
    const url = page.url();
    const buttons = await page.evaluate(() => 
      [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t).slice(0, 10));
    const inputs = await page.evaluate(() => 
      [...document.querySelectorAll('input')].map(i => i.type || i.placeholder || 'input').slice(0, 5));
    const textSnippets = await page.evaluate(() => 
      [...document.querySelectorAll('*')]
        .filter(e => e.children.length === 0 && e.textContent.trim().length > 2 && e.textContent.trim().length < 30)
        .map(e => e.textContent.trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 15));
    const screenshotPath = `/tmp/browserless-debug-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    return { url, buttons, inputs, textSnippets, screenshot: screenshotPath };
  }

  // Helper: fail with debug info
  async function failStep(step, error, extra = {}) {
    const debug = await getDebugInfo();
    console.log(JSON.stringify({ ok: false, step, error, debug, ...extra }));
    await browser.close();
  }

  try {
    // Step 1: Login
    console.error('Step 1/6: Logging in...');
    console.error(`  Credentials: email=...${creds.username.slice(-4)}, pwd=...${creds.password.slice(-4)}`);
    await page.goto('https://substack.com/sign-in', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    
    // 1a: Fill email
    const emailInput = await page.$('input[type="email"]');
    if (!emailInput) {
      await failStep(1, 'Email input not found');
      return;
    }
    await page.type('input[type="email"]', creds.username);
    console.error('  Entered email');
    
    // 1b: Click "Sign in with password"
    await new Promise(r => setTimeout(r, 500));
    const signInRect = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(e => 
        e.textContent === 'Sign in with password' && e.children.length === 0);
      if (el) {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
      return null;
    });
    if (!signInRect) {
      await failStep(1, '"Sign in with password" link not found');
      return;
    }
    await page.mouse.click(signInRect.x, signInRect.y);
    console.error('  Clicked "Sign in with password"');
    await new Promise(r => setTimeout(r, 1000));
    
    // 1c: Fill password
    const pwdInput = await page.$('input[type="password"]');
    if (!pwdInput) {
      await failStep(1, 'Password field not found after clicking sign-in link');
      return;
    }
    await page.type('input[type="password"]', creds.password);
    console.error('  Entered password');
    
    // 1d: Click Continue
    const continueRect = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Continue'));
      if (btn) {
        const rect = btn.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
      return null;
    });
    if (!continueRect) {
      await failStep(1, 'Continue button not found');
      return;
    }
    await page.mouse.click(continueRect.x, continueRect.y);
    console.error('  Clicked Continue, waiting...');
    await new Promise(r => setTimeout(r, 3000));

    // 1e: Check what page we're on after login attempt
    const postLoginUrl = page.url();
    const postLoginText = await page.evaluate(() => document.body.innerText.slice(0, 500));
    await page.screenshot({ path: '/tmp/post-login-debug.png' });
    console.error(`  Post-login URL: ${postLoginUrl}`);
    console.error(`  Post-login text preview: ${postLoginText.slice(0, 100)}...`);
    
    // Check for 2FA
    const has2FA = await page.evaluate(() => document.body.innerText.includes('Two-factor'));
    if (has2FA) {
      await failStep(1, '2FA required - manual intervention needed', { needs2FA: true });
      return;
    }

    // Step 2: Verify login and handle onboarding
    console.error('Step 2/6: Verifying login...');
    await page.goto('https://substack.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    
    // Check for onboarding modal ("Select 3 topics") and dismiss it
    const hasOnboarding = await page.evaluate(() => 
      document.body.innerText.includes('Select 3 topics') || 
      document.body.innerText.includes('Select 3 more'));
    if (hasOnboarding) {
      console.error('  Detected onboarding modal, dismissing...');
      // Click the X button to close modal
      const closeBtn = await page.evaluate(() => {
        const btn = document.querySelector('[aria-label="Close"], button svg, .close-button');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
        // Try clicking outside modal
        return { x: 50, y: 50 };
      });
      await page.mouse.click(closeBtn.x, closeBtn.y);
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // Check we're actually logged in - look for Create button AND no Sign in button
    const loginCheck = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
      const hasCreate = buttons.some(b => b.includes('Create') || b.includes('New post'));
      const hasSignIn = buttons.some(b => b === 'Sign in' || b === 'Create account');
      const createBtn = [...document.querySelectorAll('button')].find(b => 
        b.textContent.includes('Create') && !b.textContent.includes('account'));
      if (createBtn) {
        const rect = createBtn.getBoundingClientRect();
        return { loggedIn: hasCreate && !hasSignIn, buttons, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
      return { loggedIn: false, buttons };
    });
    
    if (!loginCheck.loggedIn) {
      await failStep(2, 'Not logged in - Sign in button still visible', { buttonsFound: loginCheck.buttons });
      return;
    }
    const createBtn = loginCheck;
    console.error('  Login verified - Create button found, no Sign in button');

    // Step 3: Click Create
    console.error('Step 3/6: Opening composer...');
    await page.mouse.click(createBtn.x, createBtn.y);
    console.error('  Clicked Create');
    await new Promise(r => setTimeout(r, 1000));

    // Step 4: Click Note option
    console.error('Step 4/6: Selecting Note...');
    const noteBtn = await page.evaluate(() => {
      const el = [...document.querySelectorAll('*')].find(e => 
        e.textContent.trim() === 'Note' && e.children.length === 0);
      if (el) {
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
      return null;
    });
    if (!noteBtn) {
      await failStep(4, 'Note option not found in menu');
      return;
    }
    await page.mouse.click(noteBtn.x, noteBtn.y);
    console.error('  Clicked Note');
    await new Promise(r => setTimeout(r, 1000));

    // Step 5: Type note
    console.error('Step 5/6: Typing note...');
    await new Promise(r => setTimeout(r, 500));
    const editorFound = await page.evaluate((text) => {
      const editor = document.querySelector('[contenteditable="true"]');
      if (editor) {
        editor.focus();
        editor.innerHTML = `<p>${text}</p>`;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return true;
      }
      return false;
    }, noteText);
    if (!editorFound) {
      await failStep(5, 'Editor not found');
      return;
    }
    console.error('  Typed note');
    await new Promise(r => setTimeout(r, 500));

    // Step 6: Click Post
    console.error('Step 6/6: Posting...');
    const postBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find(b => 
        b.textContent.trim() === 'Post');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        return { disabled: btn.disabled, x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
      }
      return null;
    });
    if (!postBtn) {
      await failStep(6, 'Post button not found');
      return;
    }
    if (postBtn.disabled) {
      await failStep(6, 'Post button is disabled - text may not have been entered properly');
      return;
    }
    await page.mouse.click(postBtn.x, postBtn.y);
    console.error('  Clicked Post');
    await new Promise(r => setTimeout(r, 3000));

    // Try to get note URL
    await page.goto('https://substack.com/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    
    const noteUrl = await page.evaluate(() => {
      const link = document.querySelector('a[href*="/note/"]');
      return link?.href || null;
    });

    console.log(JSON.stringify({ 
      ok: true, 
      posted: true, 
      noteUrl: noteUrl || 'Could not retrieve - check profile manually',
      noteText: noteText.slice(0, 50) + (noteText.length > 50 ? '...' : '')
    }));

  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.message, step: 'unknown' }));
  }

  await browser.close();
}

const [cmd, ...args] = process.argv.slice(2);

const commands = {
  'post-note': () => cmdPostNote(args.join(' ')),
  open: () => cmdOpen(args[0]),
  screenshot: () => cmdScreenshot(args[0]),
  snapshot: () => cmdSnapshot(),
  click: () => cmdClick(args[0]),
  type: () => cmdType(args[0], args.slice(1).join(' ')),
  eval: () => cmdEval(args.join(' ')),
  login: () => cmdLogin(args[0]),
  close: () => cmdClose(),
};

if (!cmd || !commands[cmd]) {
  console.error(`Usage: browserless.mjs <command> [args]

Commands:
  post-note <text>        Post a Substack note (login + post in one shot)
  
  # Atomic commands (for debugging/recovery):
  login <site>            Auto-login
  open <url>              Navigate to URL
  screenshot [path]       Take screenshot
  snapshot                Get element tree
  click <selector>        Click element
  type <selector> <text>  Type into element
  eval <code>             Run JavaScript in page
  close                   End session

Supported sites: ${Object.keys(LOGIN_FLOWS).join(', ')}`);
  process.exit(1);
}

commands[cmd]().catch(e => {
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
