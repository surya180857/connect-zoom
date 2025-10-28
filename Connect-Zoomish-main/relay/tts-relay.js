// tts-relay.js — ElevenLabs -> MP3 -> PCM 48k mono 20ms frames (robust logs)
require('dotenv').config({ path: process.env.ENVFILE || '.env' });
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const ffmpeg = require('fluent-ffmpeg');
const which = require('which');
const { PassThrough, Readable } = require('stream');
const path = require('path');
const fs = require('fs');

const RELAY_HOST = process.env.RELAY_HOST || '127.0.0.1';
const RELAY_PORT = parseInt(process.env.RELAY_PORT || '8080', 10);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';

// point fluent-ffmpeg at a real ffmpeg binary
try {
  const bin = which.sync('ffmpeg');
  ffmpeg.setFfmpegPath(bin);
  console.log('[relay] ffmpeg:', bin);
} catch {
  console.warn('[relay] ffmpeg not found in PATH; fluent-ffmpeg may fail');
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

// optional static for local file tests
const filesDir = path.join(__dirname, 'files');
if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir);
app.use('/files', express.static(filesDir, { setHeaders: (res)=>res.set('Access-Control-Allow-Origin','*') }));

// session tracking
const sessions = new Map(); // id -> { clients:Set<ws>, kill:fn|null, playing:boolean }
const ensureSession = id => sessions.get(id) || sessions.set(id, { clients:new Set(), kill:null, playing:false }).get(id);
const ctrl = (s,obj)=>{const b=Buffer.from(JSON.stringify(obj)); for(const ws of s.clients) if(ws.readyState===1) ws.send(b);};
const pcm  = (s,buf)=>{for(const ws of s.clients) if(ws.readyState===1) ws.send(buf);};

function streamMp3ToPcmFrames(mp3Stream, onFrame, onEnd, onError) {
  const pcmStream = new PassThrough();
  const proc = ffmpeg(mp3Stream)
    .noVideo()
    .audioCodec('pcm_s16le')
    .audioChannels(1)
    .audioFrequency(48000)
    .format('s16le')
    .on('start', cmd => console.log('[relay] ffmpeg start:', cmd))
    .on('error', err => onError(err))
    .on('end',   () => onEnd())
    .pipe(pcmStream, { end: true });

  let carry = Buffer.alloc(0);
  let frames = 0, bytes = 0;
  const BYTES=2, SAMPLES=960, FRAME=SAMPLES*BYTES;

  pcmStream.on('data', chunk => {
    let data = Buffer.concat([carry, chunk]);
    let off = 0;
    while (data.length - off >= FRAME) {
      const slice = data.slice(off, off + FRAME);
      onFrame(slice); frames++; bytes += slice.length;
      off += FRAME;
    }
    carry = data.slice(off);
  });

  const finish = () => setTimeout(() => {
    console.log(`[relay] ffmpeg done: ${frames} frames, ${bytes} bytes (~${(frames*20/1000).toFixed(2)}s)`);
  }, 10);
  proc.on('end', finish);

  return proc;
}

async function elevenlabsMp3(text, voiceId) {
  if (!ELEVENLABS_API_KEY) throw new Error('Missing ELEVENLABS_API_KEY');
  const vid = voiceId || ELEVENLABS_VOICE_ID; if (!vid) throw new Error('Missing ELEVENLABS_VOICE_ID');

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      optimize_streaming_latency: 2,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(()=> '');
    throw new Error(`ElevenLabs ${resp.status}: ${errText.slice(0,200)}`);
  }
  if (!resp.body) throw new Error('No response body from ElevenLabs');

  return Readable.fromWeb(resp.body);
}

app.post('/speak', async (req,res) => {
  try {
    const { session_id, text, voice_id } = req.body || {};
    if (!session_id || !text) return res.status(422).json({ error: 'session_id and text required' });

    const s = ensureSession(session_id);
    if (s.clients.size === 0) {
      return res.status(409).json({ error: 'no bot connected for this session_id' });
    }

    if (s.playing && s.kill) { try { s.kill(); } catch {} }
    s.playing = true;

    console.log(`[relay] speak: sid=${session_id} clients=${s.clients.size} text="${String(text).slice(0,60)}"`);
    const mp3 = await elevenlabsMp3(text, voice_id);

    ctrl(s, { type:'start', session_id });
    let sent = 0;
    const proc = streamMp3ToPcmFrames(
      mp3,
      (frame) => { sent++; pcm(s, frame); },
      () => { s.playing=false; s.kill=null; ctrl(s, { type:'end', session_id }); console.log(`[relay] stream finished: ${sent} frames`); },
      (err) => { s.playing=false; s.kill=null; ctrl(s, { type:'error', session_id, detail:String(err) }); console.error('[relay] ffmpeg error:', err); }
    );
    s.kill = () => { try { proc.kill('SIGKILL'); } catch {} };

    res.status(202).json({ accepted:true, session_id });
  } catch (e) {
    console.error('[relay] speak error:', e);
    res.status(500).json({ error: String(e) });
  }
});

app.post('/interrupt', (req,res) => {
  const { session_id } = req.body || {};
  if (!session_id) return res.status(422).json({ error: 'session_id required' });
  const s = sessions.get(session_id);
  if (s?.kill) { try { s.kill(); } catch {} s.kill=null; s.playing=false; ctrl(s, { type:'interrupted', session_id }); console.log('[relay] interrupted', session_id); }
  res.status(204).end();
});

app.get('/healthz', (_req,res)=>res.status(200).json({ ok:true }));

const server = app.listen(RELAY_PORT, RELAY_HOST, () => console.log(`[relay] http://${RELAY_HOST}:${RELAY_PORT}`));
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req,socket,head) => {
  if (!req.url.includes('/audio?')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    const url = new URL(req.url, `http://${RELAY_HOST}:${RELAY_PORT}`);
    const sessionId = url.searchParams.get('session');
    if (!sessionId) return ws.close(1008, 'session required');
    const s = ensureSession(sessionId);
    s.clients.add(ws);
    ws.on('close', () => s.clients.delete(ws));
    ws.send(JSON.stringify({ type:'hello', session_id:sessionId, sample_rate_hz:48000 }));
    console.log('[relay] ws client joined', sessionId, 'now', s.clients.size);
  });
});

