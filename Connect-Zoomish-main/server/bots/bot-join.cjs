// Minimal headless bot that joins and stays. No recording.
const { chromium } = require('playwright');

const BASE  = process.env.SIGNALING_URL || 'https://aira.airahr.ai';
const ROOM  = process.env.ROOM_ID       || 'demo-room';
const NAME  = process.env.BOT_NAME      || 'Observer Bot';
const ROLE  = process.env.ROLE          || 'observer'; // observer recommended
const HOLD  = parseInt(process.env.HOLD_MIN || '480', 10); // minutes to stay

(async () => {
  const args = [
    '--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
  ];
  const browser = await chromium.launch({ headless: true, args });
  const ctx = await browser.newContext({ permissions: ['microphone','camera'] });
  const page = await ctx.newPage();

  // Build URL
  const u = new URL(BASE);
  u.searchParams.set('room', ROOM);
  u.searchParams.set('name', NAME);
  u.searchParams.set('role', ROLE);

  console.log(`[bot] goto ${u.toString()}`);
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });

  // Try app helper first
  const usedHelper = await page.evaluate(async () => {
    if (typeof window.join === 'function') {
      try { await window.join(); return true; } catch {}
    }
    return false;
  });

  let joined = usedHelper;
  if (!joined) {
    // Click a “Join” button with Playwright locators (not CSS :has-text)
    const btn = page.getByRole('button', { name: /join|enter|start|continue/i }).first();
    if (await btn.count()) {
      try { await btn.click({ timeout: 5000 }); joined = true; } catch {}
    }
  }
  if (!joined) {
    // Last fallback: DOM scan
    joined = await page.evaluate(() => {
      const trySel = (s)=>{const e=document.querySelector(s); if(e){e.click(); return true;} return false;};
      if (trySel('#join')) return true;
      const t=[...document.querySelectorAll('button')].find(b=>/join|enter|start/i.test((b.innerText||'').trim()));
      if (t){ t.click(); return true; }
      return false;
    });
  }

  console.log(joined ? '[bot] joined' : '[bot] assuming auto-join/no button');

  // Simple heartbeat so you can tail logs
  let min = 0;
  const t = setInterval(() => { min++; console.log(`[bot] alive ${min} min in room ${ROOM}`); }, 60_000);

  // Hold then exit
  const holdMs = Math.max(1, HOLD) * 60_000;
  await page.waitForTimeout(holdMs);
  clearInterval(t);
  await browser.close();
  console.log('[bot] done');
})().catch(e => { console.error('[bot] fatal', e); process.exit(1); });
