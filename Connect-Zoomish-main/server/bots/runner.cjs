/**
 * 🤖 RECORDING BOT - Automated Video Call Recorder
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * 📋 PURPOSE:
 * This is an automated bot that joins video calls headlessly (without showing a browser window)
 * and records everything that happens. Think of it like having an invisible participant
 * that quietly records the entire meeting for later review.
 * 
 * 🎯 WHAT IT DOES:
 * • Launches a headless Chrome browser using Playwright
 * • Automatically joins a video call room
 * • Records all participants' video and audio into WebM files
 * • Takes periodic screenshots of the main participant
 * • Can record just audio from specific participants
 * • Runs for a specified duration then exits cleanly
 * 
 * 💡 REAL-WORLD ANALOGY:
 * Imagine you hired a professional videographer who:
 * - Shows up to meetings invisibly
 * - Records everything without disrupting the call
 * - Organizes all recordings by room and timestamp
 * - Takes photos at regular intervals
 * - Leaves quietly when the meeting ends
 * 
 * 🔧 LOCATION: /runner.cjs (Root directory - main recording script)
 * 
 * 📦 DEPENDENCIES:
 * • playwright: Controls headless Chrome browser for automation
 * • fs: File system operations for saving recordings
 * • path: File path utilities for organizing output files
 * 
 * 🎮 USAGE:
 * Environment variables control everything:
 * ROOM_ID=my-room DURATION_MIN=60 REC_OUT_DIR=/recordings node runner.cjs
 * 
 * 🚨 COMMON ISSUES:
 * • Chrome permissions needed for microphone/camera access
 * • Large file sizes - recordings can be several GB per hour
 * • Network stability affects recording quality
 * 
 * 👶 BEGINNER NOTES:
 * - This is like a "screen recorder" but for web browsers
 * - It uses Playwright (browser automation) instead of human clicking
 * - The bot pretends to be a regular user but saves everything to files
 * - WebM is a video format that works well for web recordings
 */

// runner.cjs — headless join + optional recording + candidate-only audio + snapshots
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// ------ logging helpers: produce timestamps like: 2025-08-20 05:18:40,412 - <message>
function nowForLog() {
  const iso = new Date().toISOString(); // e.g. 2025-08-20T05:18:40.412Z
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d+)Z$/);
  if (m) {
    const ms = (m[3].slice(0,3)).padEnd(3, '0');
    return `${m[1]} ${m[2]},${ms}`;
  }
  return iso.replace('T', ' ').replace('Z','');
}
const log = (...a) => console.log(`${nowForLog()} - ${a.join(' ')}`);
const logErr = (...a) => console.error(`${nowForLog()} - ${a.join(' ')}`);

/**
 * 🔧 CONFIGURATION SETTINGS
 * ═══════════════════════════════════════════════════════════════════════════════
 * All settings come from environment variables with sensible defaults
 */

// 🌐 Connection Settings - Where and how to join the call
const BASE  = process.env.SIGNALING_URL || 'https://aira.airahr.ai';  // 🏠 Server URL
const ROOM  = process.env.ROOM_ID       || 'demo-room';               // 🚪 Room to join
const NAME  = process.env.BOT_NAME      || 'Recorder Bot';           // 🤖 Bot's display name
const ROLE  = process.env.ROLE          || 'participant';            // 👤 Bot's role (observer/participant). Default changed to 'participant' so the bot is visible in the UI.
const HOLD  = parseInt(process.env.DURATION_MIN || '480', 10);       // ⏱️ How long to record (minutes)

// 🎥 Recording Settings - Video quality and output
const REC_OUT_DIR = process.env.REC_OUT_DIR || '';                   // 📁 Where to save recordings
const REC_WIDTH   = parseInt(process.env.REC_WIDTH  || '1280', 10);  // 📐 Video width (pixels)
const REC_HEIGHT  = parseInt(process.env.REC_HEIGHT || '720', 10);   // 📐 Video height (pixels)  
const REC_FPS     = parseInt(process.env.REC_FPS    || '25', 10);    // 🎬 Frames per second
const REC_CODEC   = (process.env.REC_CODEC || 'vp8').toLowerCase(); // 🎞️ Video codec (vp8/vp9)
const V_BITRATE   = parseInt(process.env.VIDEO_BITRATE || '1200000', 10); // 💾 Video quality (bits/sec)

// 🎧 Special Audio Recording - Record just one person's audio separately
const CANDIDATE_ONLY_AUDIO = (process.env.CANDIDATE_ONLY_AUDIO || '0') === '1';

// 📸 Screenshot Settings - Periodic photos of the call
const SNAP_DIR       = process.env.SNAP_DIR || '/var/snaps';         // 📁 Photo storage folder
const SNAP_EVERY_SEC = parseInt(process.env.SNAP_EVERY_SEC || '60', 10); // ⏰ Photo interval (seconds)
const SNAP_WIDTH     = parseInt(process.env.SNAP_WIDTH || '640', 10);     // 📐 Photo width
const SNAP_QUALITY   = Math.max(0, Math.min(1, parseFloat(process.env.SNAP_QUALITY || '0.8'))); // 🎨 JPEG quality

// 🎤 Fake Audio - Use a WAV file instead of microphone (for testing)
const FAKE_AUDIO_WAV = process.env.FAKE_AUDIO_WAV || '';

/**
 * 🛠️ UTILITY FUNCTIONS
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// 🕐 Generate timestamp for filenames (ISO format with safe characters)
function nowStamp(){ return new Date().toISOString().replace(/[:.]/g,'-'); }

// 📁 Create directory if it doesn't exist (like mkdir -p)
function ensureDir(p){ fs.mkdirSync(p, { recursive:true }); }

/**
 * 🚀 MAIN EXECUTION FLOW
 * ═══════════════════════════════════════════════════════════════════════════════
 * This is where the magic happens! The bot:
 * 1. Sets up recording directories
 * 2. Launches a headless Chrome browser
 * 3. Joins the video call automatically
 * 4. Starts recording everything
 * 5. Takes periodic screenshots
 * 6. Waits for the specified duration
 * 7. Cleans up and exits
 */
(async () => {
  log('🤖 [RECORDING BOT] Starting up...');
  
  // 📁 STEP 1: Prepare output directories
  const recDir = REC_OUT_DIR ? path.join(REC_OUT_DIR, ROOM) : '';
  const snapDir = path.join(SNAP_DIR, ROOM);
  if (recDir) ensureDir(recDir);
  ensureDir(snapDir);
  log(`📁 Recordings will be saved to: ${recDir || 'disabled'}`);
  log(`📸 Screenshots will be saved to: ${snapDir}`);

  // 🌐 STEP 2: Launch headless Chrome with special permissions
  const args = [
    '--no-sandbox','--disable-dev-shm-usage',        // 🔒 Security flags for servers
    '--autoplay-policy=no-user-gesture-required',    // 🎵 Allow audio/video without user click
    '--use-fake-ui-for-media-stream',                // 🎭 Fake media permissions (no popups)
    '--use-fake-device-for-media-stream',            // 📷 Use fake camera/microphone
  ];
  if (FAKE_AUDIO_WAV) args.push(`--use-file-for-fake-audio-capture=${FAKE_AUDIO_WAV}`);

  const browser = await chromium.launch({ headless:true, args });
  const ctx = await browser.newContext({ permissions:['microphone','camera'] });
  const page = await ctx.newPage();
  log('🌐 Headless browser launched with media permissions');

  // 💾 STEP 3: Set up file saving functions (exposed to browser page)
  // These functions let the browser page save recordings back to Node.js
  await page.exposeBinding('__append', (_src, { which, bytes }) => {
    // 🎬 Main recording (all participants) or 🎤 candidate-only audio
    const base = which === 'main' ? (recDir && path.join(recDir, `${ROOM}-${nowStamp()}.webm`))
                                  : (recDir && path.join(recDir, `candidate-audio-${nowStamp()}.webm`));
    if (!base) return;
    const fn = base;
    fs.appendFileSync(fn, Buffer.from(bytes)); // 💾 Append video/audio data to file
  });
  
  await page.exposeBinding('__saveJpeg', (_src, bytes) => {
    // 📸 Save screenshot as JPEG with timestamp
    const fn = path.join(snapDir, `${ROOM}-${nowStamp()}.jpg`);
  fs.writeFileSync(fn, Buffer.from(bytes));
  log('📸 [SCREENSHOT] Saved:', fn);
  });

  // 🧠 STEP 4: Install recording brain into the browser page
  // This is the most complex part - we inject JavaScript code that runs inside
  // the browser and handles all the video/audio recording magic
  await page.addInitScript(({ REC_WIDTH, REC_HEIGHT, REC_FPS, REC_CODEC, V_BITRATE, SNAP_WIDTH, SNAP_EVERY_SEC, SNAP_QUALITY, CANDIDATE_ONLY_AUDIO }) => {
    const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

    /**
     * 🎬 VIDEO RECORDING FUNCTION
     * ═══════════════════════════════════════════════════════════════════════════════
     * This function is like a video editor that:
     * 1. Finds all participants' video streams
     * 2. Draws them onto a canvas (like a movie screen)
     * 3. Mixes all their audio together
     * 4. Records the combined result
     */
    async function startRecorders() {
      console.log('🎬 Starting video/audio recording system...');
      
      // 👥 FIND ALL PARTICIPANTS: Look for video elements (exclude our own camera)
      const grid = document.getElementById('video-grid') || document.body;
      let remotes = Array.from(grid.querySelectorAll('.tile video, .tile audio, video, audio'))
                         .filter(el => !el.closest('#wrap-self'));
      
      // 🎨 CREATE CANVAS: This is like a blank movie screen we'll draw on
      const canvas = Object.assign(document.createElement('canvas'), { width: REC_WIDTH, height: REC_HEIGHT });
      const ctx = canvas.getContext('2d');
      
      // 📐 LAYOUT CALCULATOR: Figures out how to arrange multiple videos in a grid
      function layout(n) {
        const cols = Math.ceil(Math.sqrt(n));          // How many columns?
        const rows = Math.ceil(n / cols);              // How many rows?
        const cw = Math.floor(REC_WIDTH / cols);       // Width of each video tile
        const ch = Math.floor(REC_HEIGHT / rows);      // Height of each video tile
        return { cols, rows, cw, ch, rows };
      }
      
      let rafId;
      // 🎞️ ANIMATION LOOP: Continuously draws all videos onto the canvas (like a film projector)
      function draw() {
        // Refresh the list of active videos
        remotes = Array.from(grid.querySelectorAll('.tile video, video')).filter(v => !v.closest('#wrap-self') && v.videoWidth>0);
        const n = Math.max(1, remotes.length);
        const { cols, rows, cw, ch } = layout(n);
        
        // Clear canvas with dark background
        ctx.fillStyle = '#111'; 
        ctx.fillRect(0,0,REC_WIDTH,REC_HEIGHT);
        
        // Draw each participant's video in a grid position
        remotes.forEach((v,i)=>{
          const r = Math.floor(i/cols), c = i%cols;    // Calculate grid position
          const x = c*cw, y = r*ch;                    // Calculate pixel position
          try { 
            ctx.drawImage(v, x, y, cw, ch);            // Draw video frame to canvas
          } catch {}
        });
        
        rafId = requestAnimationFrame(draw);           // Schedule next frame
      }
      draw(); // Start the animation loop
      
      // 📹 CAPTURE VIDEO: Turn our canvas into a video stream
      const canvasStream = canvas.captureStream(REC_FPS);
      const videoTrack = canvasStream.getVideoTracks()[0];

      // Mix all remote audios
      const ac = new AudioContext();
      const mixDest = ac.createMediaStreamDestination();
      const audioEls = Array.from(grid.querySelectorAll('.tile audio, video')).filter(e=>!e.closest('#wrap-self'));
      audioEls.forEach(el => {
        try {
          const src = ac.createMediaElementSource(el);
          src.connect(mixDest);
        } catch {}
      });
      const mixTrack = mixDest.stream.getAudioTracks()[0];

      const combined = new MediaStream();
      if (videoTrack) combined.addTrack(videoTrack);
      if (mixTrack) combined.addTrack(mixTrack);

      const mainMime = (REC_CODEC === 'vp9' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus'))
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm;codecs=vp8,opus';

      const main = new MediaRecorder(combined, { mimeType: mainMime, videoBitsPerSecond: V_BITRATE });
      main.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0) {
          const buf = new Uint8Array(await ev.data.arrayBuffer());
          // @ts-ignore
          window.__append({ which:'main', bytes: buf });
        }
      };
      main.start(4000);

      // optional candidate-only audio
      let cand = null;
      if (CANDIDATE_ONLY_AUDIO) {
        function pickCandidateAudio() {
          // prefer element tagged with [data-role="candidate"]
          let el = document.querySelector('[data-role="candidate"] video, [data-role="candidate"] audio');
          if (!el) {
            // fallback: choose the largest remote video
            const vids = Array.from(grid.querySelectorAll('video')).filter(v => !v.closest('#wrap-self') && v.videoWidth>0);
            vids.sort((a,b)=> (b.videoWidth*b.videoHeight)-(a.videoWidth*a.videoHeight));
            el = vids[0] || null;
          }
          return el;
        }
        const target = pickCandidateAudio();
        if (target) {
          const s = new MediaStream();
          if (target.captureStream) {
            try {
              const ts = target.captureStream();
              const at = ts.getAudioTracks()[0];
              if (at) s.addTrack(at);
            } catch {}
          }
          if (s.getAudioTracks().length) {
            cand = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 });
            cand.ondataavailable = async (ev) => {
              if (ev.data && ev.data.size > 0) {
                const buf = new Uint8Array(await ev.data.arrayBuffer());
                // @ts-ignore
                window.__append({ which:'cand', bytes: buf });
              }
            };
            cand.start(4000);
          }
        }
      }

      return () => {
        cancelAnimationFrame(rafId);
        try { main.stop(); } catch {}
        try { cand && cand.stop(); } catch {}
        ac.close();
      };
    }

    async function startSnapshots() {
      const grid = document.getElementById('video-grid') || document.body;
      function pickCandidateVideo() {
        let el = document.querySelector('[data-role="candidate"] video');
        if (el) return el;
        const vids = Array.from(grid.querySelectorAll('video')).filter(v => !v.closest('#wrap-self') && v.videoWidth>0);
        vids.sort((a,b)=> (b.videoWidth*b.videoHeight)-(a.videoWidth*a.videoHeight));
        return vids[0] || null;
      }
      const v = pickCandidateVideo();
      if (!v) return;
      const aspect = v.videoWidth ? v.videoHeight / v.videoWidth : 9/16;
      const W = SNAP_WIDTH, H = Math.round(W*aspect);
      const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const ctx = canvas.getContext('2d');
      async function once() {
        try {
          ctx.drawImage(v, 0, 0, W, H);
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', SNAP_QUALITY));
          const b = new Uint8Array(await blob.arrayBuffer());
          // @ts-ignore
          await window.__saveJpeg(b);
        } catch {}
      }
      await once();
      setInterval(once, Math.max(1, SNAP_EVERY_SEC)*1000);
    }

    // expose
    window.__airaStartRecorders = startRecorders;
    window.__airaStartSnapshots = startSnapshots;
  }, { REC_WIDTH, REC_HEIGHT, REC_FPS, REC_CODEC, V_BITRATE, SNAP_WIDTH, SNAP_EVERY_SEC, SNAP_QUALITY, CANDIDATE_ONLY_AUDIO });

  // Build URL and join
  const u = new URL(BASE);
  u.searchParams.set('room', ROOM);
  u.searchParams.set('name', NAME);
  u.searchParams.set('role', ROLE);
  log('[bot] goto', u.toString());
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
  // Try to auto-accept any in-page recording consent dialogs (e.g. "Please accept recording to join")
  try {
    const consentLocator = page.getByText(/accept recording|allow recording|please accept recording|allow|start recording|i agree/i).first();
    if (await consentLocator.count()) {
      await consentLocator.click({ timeout: 2000 }).catch(()=>{});
      log('[bot] clicked consent button (locator)');
    } else {
      // fallback: evaluate in-page and click any matching button/input/link
      await page.evaluate(() => {
        try {
          const re = /accept recording|allow recording|please accept recording|allow|start recording|i agree/i;
          const els = Array.from(document.querySelectorAll('button,input[type=button],a'));
          for (const e of els) {
            try {
              const txt = (e.innerText || e.value || '').trim();
              if (re.test(txt)) { e.click(); break; }
            } catch {}
          }
        } catch {}
      }).catch(()=>{});
      log('[bot] attempted consent click (fallback)');
    }
  } catch (err) {
    logErr('[bot] consent click error', err && err.message ? err.message : err);
  }

  // Try app helper, else click a "Join" button
  const usedHelper = await page.evaluate(async () => {
    if (typeof window.join === 'function') { try { await window.join(); return true; } catch {} }
    return false;
  });
  let joined = usedHelper;
  if (!joined) {
    const btn = page.getByRole('button', { name: /join|enter|start|continue/i }).first();
    if (await btn.count()) { try { await btn.click({ timeout:5000 }); joined=true; } catch {} }
  }
  if (!joined) {
    joined = await page.evaluate(() => {
      const t=[...document.querySelectorAll('button')].find(b=>/join|enter|start/i.test((b.innerText||'').trim()));
      if (t){ t.click(); return true; }
      return false;
    });
  }
  log(joined ? '[bot] joined' : '[bot] assuming auto-join');

  // Start recorders / snapshots
  if (REC_OUT_DIR) await page.evaluate(() => window.__airaStartRecorders());
  await page.evaluate(() => window.__airaStartSnapshots());

  // Heartbeat
  let min=0; const hb = setInterval(()=>{ min++; log(`[bot] alive ${min} min in room ${ROOM}`); }, 60_000);

  // Hold
  const holdMs = Math.max(1, HOLD) * 60_000;
  await page.waitForTimeout(holdMs);
  clearInterval(hb);
  await browser.close();
  log('[bot] done');
})().catch(e => { console.error('[bot] fatal', e); process.exit(1); });
// end
