// headless bot that logs audio in/out kbps via getStats()
const { chromium } = require('playwright');

const BASE  = process.env.SIGNALING_URL || 'https://aira.airahr.ai';
const ROOM  = process.env.ROOM_ID       || 'demo-room';
const NAME  = process.env.BOT_NAME      || 'AIRA Monitor';
const ROLE  = process.env.ROLE          || 'observer';
const WAV   = process.env.FAKE_AUDIO_WAV || '';
const STAT_MS = parseInt(process.env.STAT_MS || '1500', 10);

(async () => {
  const args = [
    '--no-sandbox','--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
  ];
  if (WAV) args.push(`--use-file-for-fake-audio-capture=${WAV}`);

  const browser = await chromium.launch({ headless: true, args });
  const ctx = await browser.newContext({ permissions: ['microphone','camera'] });
  const page = await ctx.newPage();

  // collect RTCPeerConnections
  await page.addInitScript(() => {
    const pcs=[]; const Orig = window.RTCPeerConnection;
    window.RTCPeerConnection = function(cfg,...r){const pc=new Orig(cfg||{},...r); pcs.push(pc); return pc;};
    window.__pcs = pcs;
  });

  page.on('console', m => { const t=m.text(); if (t.startsWith('[JOIN]')||t.startsWith('[AUDIO]')) console.log(t); });

  // navigate and click Join
  const u = new globalThis.URL(BASE);
  u.searchParams.set('room', ROOM);
  u.searchParams.set('name', NAME);
  u.searchParams.set('role', ROLE);

  await page.goto(u.toString(), { waitUntil: 'domcontentloaded' });
  const joined = await page.evaluate(async ()=>{
    const click = (s)=>{const e=document.querySelector(s); if(e){e.click(); return true;} return false;};
    if (typeof window.join==='function'){try{await window.join(); return true;}catch{}}
    return ['button:has-text("Join")','button[data-testid=join]','#join','button.primary'].some(click);
  });
  console.log('[JOIN] ' + (joined?'clicked':'no button found; assuming auto-join'));

  // stats poller
  await page.evaluate((ms)=>{
    const last=new Map(), fmt=n=>(Math.round(n*10)/10).toFixed(1);
    async function tick(){
      for(const [i,pc] of (window.__pcs||[]).entries()){
        if(pc.connectionState==='closed') continue;
        const st=await pc.getStats(); let ins=[], outs=[];
        st.forEach(r=>{
          const isIn=(r.type==='inbound-rtp'&&r.kind==='audio');
          const isOut=(r.type==='outbound-rtp'&&r.kind==='audio');
          if(!isIn && !isOut) return;
          const key=r.id, now=performance.now();
          const bytes=(r.bytesReceived??r.bytesSent)||0;
          const prev=last.get(key)||{bytes,t:now}; const dt=Math.max(0.001,(now-prev.t)/1000);
          const bps=(bytes-prev.bytes)*8/dt; last.set(key,{bytes,t:now});
          const line=`${isIn?'in':'out'} ${fmt(bps/1000)} kbps`
            +(r.jitter!=null?` jitter=${r.jitter.toFixed(3)}`:'')
            +(r.packetsLost!=null?` lost=${r.packetsLost}`:'')
            +(r.totalAudioEnergy!=null?` energy=${r.totalAudioEnergy.toFixed(3)}`:'');
          (isIn?ins:outs).push(line);
        });
        if(ins.length||outs.length) console.log(`[AUDIO][pc${i}] ${[...ins,...outs].join(' | ')}`);
      }
    }
    window.__audioTimer=setInterval(tick,ms);
  }, STAT_MS);

  // run forever
  process.on('SIGINT', async ()=>{ await browser.close(); process.exit(0); });
})();
