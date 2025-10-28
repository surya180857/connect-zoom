#!/usr/bin/env node
/* runner-safe.cjs
 * Headless "bot browser" that joins your AIRA room and stays alive.
 * Env (any of these may be set in .env or exported):
 *   BOT_JOIN_URL      - full URL with token, e.g. https://aira.airahr.ai/?t=JWT&role=bot&name=AIRA%20Bot&auto=1
 *   BOT_TOKEN         - raw JWT; we will build the URL for you
 *   BOT_NAME          - default "AIRA Bot"
 *   BOT_ROOM          - optional, appended as &room=...
 *   BOT_ORIGIN        - default https://aira.airahr.ai
 *   HEADLESS          - "1" (default) or "0" for visible
 *   CHROME_PATH       - absolute path to Chrome/Chromium (optional)
 *   ENVFILE           - alternate path to .env
 */

'use strict';

// --- env ---
try {
  require('dotenv').config({ path: process.env.ENVFILE || '.env' });
  console.log('[runner] env loaded');
} catch (e) {
  console.log('[runner] dotenv not found; relying on process.env only');
}

const fs = require('fs');
const { spawnSync } = require('child_process');

// Prefer puppeteer if available (bundled Chromium fallback), else puppeteer-core + system Chrome.
let puppeteer;
try {
  puppeteer = require('puppeteer');
  console.log('[runner] using puppeteer (bundled Chromium if needed)');
} catch {
  puppeteer = require('puppeteer-core');
  console.log('[runner] using puppeteer-core (system Chrome required)');
}

// ---- helpers ----
function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function guessChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    which('google-chrome-stable'),
    which('google-chrome'),
    which('chromium-browser'),
    which('chromium'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function ensureAutoParam(url) {
  if (/\bauto=1\b/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + 'auto=1';
}

function buildJoinUrl() {
  // Priority 1: explicit full URL
  let url = process.env.BOT_JOIN_URL || process.env.JOIN_URL || process.env.URL;
  const name = encodeURIComponent(process.env.BOT_NAME || 'AIRA Bot');
  const room = process.env.BOT_ROOM ? `&room=${encodeURIComponent(process.env.BOT_ROOM)}` : '';
  const origin = process.env.BOT_ORIGIN || 'https://aira.airahr.ai';
  const token = process.env.BOT_TOKEN;

  if (!url) {
    if (!token) {
      console.error('[runner] No BOT_JOIN_URL and no BOT_TOKEN provided. Set one in your .env.');
      process.exit(1);
    }
    url = `${origin}/?t=${encodeURIComponent(token)}&role=bot&name=${name}${room}`;
  } else {
    // make sure it has name/role if not present
    if (!/\bname=/.test(url)) url += `&name=${name}`;
    if (!/\brole=/.test(url)) url += `&role=bot`;
    if (room && !/\broom=/.test(url)) url += room;
  }
  return ensureAutoParam(url);
}

const JOIN_URL = buildJoinUrl();
console.log('[runner] join url:', JOIN_URL.replace(/t=[^.]+/,'t=***'));

// --- launch options ---
const headless = (process.env.HEADLESS || '1') !== '0';
const executablePath = (puppeteer.product === 'chrome' || puppeteer._preferredRevision) ? undefined : guessChromePath();
if (!executablePath && puppeteer._isPuppeteerCore) {
  console.warn('[runner] puppeteer-core detected and Chrome not found. Install Chrome or use `npm i puppeteer`.');
}

const defaultArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',    // auto-allow mic/cam
  '--allow-file-access-from-files',
  '--disable-dev-shm-usage',
  '--ignore-certificate-errors',
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1280,800',
  '--enable-features=WebRTCPipeWireCapturer',
  '--disable-features=AudioServiceOutOfProcess', // keep audio in-process (more stable on some servers)
  // Do NOT mute; we want audio graph active inside the page for WebRTC senders
  // '--mute-audio', // <— intentionally NOT used
];

// Some headless envs behave better with software GL
if (process.env.FORCE_SOFTWARE_GL === '1') {
  defaultArgs.push('--use-gl=swiftshader', '--disable-gpu');
}

async function launchOnce() {
  const browser = await puppeteer.launch({
    headless: headless ? 'new' : false,
    executablePath,
    args: defaultArgs,
    defaultViewport: { width: 1280, height: 800 },
  });

  const [page] = await browser.pages();
  const p = page || (await browser.newPage());

  // Forward console logs from the page (super helpful for debugging)
  p.on('console', msg => {
    const args = msg.args().map(a => a.toString());
    console.log(`[page:${msg.type()}]`, msg.text(), args.length ? args.join(' | ') : '');
  });

  p.on('pageerror', err => console.error('[page:error]', err));
  p.on('requestfailed', req => console.warn('[page:reqfail]', req.url(), req.failure()?.errorText));
  browser.on('disconnected', () => console.warn('[runner] browser disconnected'));

  // Be generous; some TURN paths take a second
  p.setDefaultTimeout(60_000);

  // Navigate and wait for the app to settle
  console.log('[runner] navigating…');
  await p.goto(JOIN_URL, { waitUntil: 'networkidle2', timeout: 60_000 });
  console.log('[runner] navigated');

  // Nudge autoplay policies in some headless builds
  await p.evaluate(() => {
    try {
      // Warm up AudioContext to satisfy certain autoplay heuristics
      // eslint-disable-next-line no-undef
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      setTimeout(() => { try { osc.stop(); ctx.close(); } catch (_) {} }, 150);
    } catch (_) {}
  });

  // Optional: wait for a custom app-ready signal if your app exposes it
  // e.g., an element like <div id="webrtc-state" data-state="connected">
  try {
    await p.waitForFunction(
      () => {
        const el = document.querySelector('#webrtc-state,[data-status]');
        const v = el?.getAttribute('data-status') || el?.getAttribute('data-state') || '';
        return /connected|ready|joined/i.test(v);
      },
      { timeout: 30_000 }
    );
    console.log('[runner] app reports connected');
  } catch {
    console.log('[runner] no explicit ready marker found; continuing to run');
  }

  // Keep alive logs so you know it's still up
  let alive = true;
  const ka = setInterval(() => alive && console.log('[runner] alive', new Date().toISOString()), 30_000);

  // Clean shutdown handlers
  const shutdown = async (code = 0) => {
    alive = false;
    clearInterval(ka);
    try { await p.close({ runBeforeUnload: true }); } catch {}
    try { await browser.close(); } catch {}
    process.exit(code);
  };

  process.on('SIGINT', () => { console.log('\n[runner] SIGINT'); shutdown(0); });
  process.on('SIGTERM', () => { console.log('\n[runner] SIGTERM'); shutdown(0); });
  process.on('uncaughtException', (e) => { console.error('[runner] uncaught', e); shutdown(1); });
  process.on('unhandledRejection', (e) => { console.error('[runner] unhandled', e); shutdown(1); });

  // Auto-recover if the page crashes
  p.on('error', async (e) => {
    console.error('[page] error:', e);
    await shutdown(1);
  });

  return { browser, page: p };
}

(async function main() {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      console.log(`[runner] launch attempt ${attempt}`);
      await launchOnce();
      // launchOnce only returns on shutdown; if it returns, break.
      break;
    } catch (e) {
      console.error('[runner] launch failed:', e?.message || e);
      const backoff = Math.min(30_000, 2_000 * attempt);
      console.log(`[runner] retrying in ${Math.round(backoff/1000)}s…`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
})();

