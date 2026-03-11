#!/usr/bin/env node
import { chromium } from '/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const BROWSERLESS_URL = 'wss://production-sfo.browserless.io/chromium/playwright';

function readCredential(name) {
  const path = `/workspace/extra/credentials/${name}`;
  return readFileSync(path, 'utf8').trim();
}

async function publishNote(noteText) {
  const token = readCredential('browserless');
  const username = readCredential('substack-username');
  const password = readCredential('substack-password');

  console.log(`Connecting to Browserless (token: ...${token.slice(-4)})`);
  
  const browser = await chromium.connect(`${BROWSERLESS_URL}?token=${token}&stealth=true`);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1: Check login state
    console.log('Navigating to Substack...');
    await page.goto('https://substack.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const isLoggedIn = await page.locator('button:has-text("New post"), button:has-text("Create")').first().isVisible().catch(() => false);
    
    if (!isLoggedIn) {
      // Step 2: Login
      console.log('Not logged in, proceeding with login...');
      await page.goto('https://substack.com/sign-in', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // Type email
      await page.locator('input[type="email"], input[placeholder*="Email"]').fill(username);
      console.log('Entered email');

      // Click "Sign in with password"
      await page.locator('text=Sign in with password').click();
      await page.waitForTimeout(500);

      // Type password
      await page.locator('input[type="password"]').fill(password);
      console.log('Entered password');

      // Click Continue
      await page.locator('button:has-text("Continue")').click();
      console.log('Clicked Continue, waiting for login...');
      await page.waitForTimeout(3000);

      // Check for 2FA
      const has2FA = await page.locator('text=Two-factor authentication').isVisible().catch(() => false);
      if (has2FA) {
        console.log('ERROR: 2FA required - manual intervention needed');
        await browser.close();
        process.exit(1);
      }

      // Verify login succeeded
      await page.goto('https://substack.com/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
      const loginSuccess = await page.locator('button:has-text("New post"), button:has-text("Create")').first().isVisible().catch(() => false);
      if (!loginSuccess) {
        console.log('ERROR: Login failed');
        await browser.close();
        process.exit(1);
      }
      console.log('Login successful');
    } else {
      console.log('Already logged in');
    }

    // Step 3: Publish a Note
    console.log('Opening note composer...');
    
    // Click Create button
    await page.locator('button:has-text("Create")').click();
    await page.waitForTimeout(1000);

    // Look for "Note" option in the menu
    const noteOption = page.locator('text=Note').first();
    if (await noteOption.isVisible()) {
      await noteOption.click();
      await page.waitForTimeout(1000);
    }

    // Find the note textarea/editor and type
    console.log('Typing note content...');
    const editor = page.locator('[contenteditable="true"], textarea[placeholder*="note"], textarea[placeholder*="Write"]').first();
    await editor.click();
    await editor.fill(noteText);
    await page.waitForTimeout(500);

    // Click Post button
    console.log('Posting note...');
    await page.locator('button:has-text("Post")').click();
    await page.waitForTimeout(3000);

    // Step 4: Capture result - look for the note URL
    console.log('Looking for note URL...');
    await page.goto('https://substack.com/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Find the most recent note link
    const noteLink = await page.locator('a[href*="/note/"]').first().getAttribute('href').catch(() => null);
    
    if (noteLink) {
      const fullUrl = noteLink.startsWith('http') ? noteLink : `https://substack.com${noteLink}`;
      console.log(`SUCCESS: Note published at ${fullUrl}`);
      await browser.close();
      return fullUrl;
    } else {
      console.log('WARNING: Could not find note URL, but post may have succeeded');
      await browser.close();
      return 'URL not found - check Substack manually';
    }

  } catch (error) {
    console.error('ERROR:', error.message);
    await browser.close();
    process.exit(1);
  }
}

// Get note text from command line args or stdin
const noteText = process.argv[2] || await new Promise((resolve) => {
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => resolve(data.trim()));
  setTimeout(() => resolve(data.trim()), 100); // timeout if no stdin
});

if (!noteText) {
  console.error('Usage: publish-note.mjs "Your note text here"');
  console.error('   or: echo "Your note text" | publish-note.mjs');
  process.exit(1);
}

publishNote(noteText);
