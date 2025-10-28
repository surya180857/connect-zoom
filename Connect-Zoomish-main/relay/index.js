// // relay/index.js — Unified STT (Deepgram) + TTS (ElevenLabs) relay
// // - /speak, /interrupt, WS /audio?session=...  (TTS fanout, 48k PCM frames)
// // - WS /ws/stt (sender -> 16k PCM; listeners receive transcript JSON)

// require('dotenv').config({ path: process.env.ENVFILE || '.env' });

// const http = require('http');
// const express = require('express');
// const cors = require('cors');
// const path = require('path');
// const fs = require('fs');
// const which = require('which');
// const ffmpeg = require('fluent-ffmpeg');
// const { PassThrough, Readable } = require('stream');
// const WebSocket = require('ws');
// const { WebSocketServer } = require('ws');

// const RELAY_HOST = process.env.RELAY_HOST || '127.0.0.1';
// const RELAY_PORT = parseInt(process.env.RELAY_PORT || process.env.PORT || '8080', 10);

// // TTS (ElevenLabs)
// const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY || '';
// const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '';
// const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_monolingual_v1';

// // STT (Deepgram)
// const DG_KEY = process.env.DEEPGRAM_API_KEY || '';
// const STT_LANGUAGE    = process.env.STT_LANGUAGE    || 'en-US';
// const STT_PUNCTUATE   = (process.env.STT_PUNCTUATE   ?? 'true').toString();
// const STT_DIARIZE     = (process.env.STT_DIARIZE     ?? 'true').toString();
// const STT_ENDPOINTING = (process.env.STT_ENDPOINTING ?? 'true').toString();
// const STT_UTTERANCES  = (process.env.STT_UTTERANCES  ?? 'true').toString();

// // === Transcript fan-out to local core (Option B) ===
// const CORE_TRANSCRIPT_URL =
//   process.env.CORE_TRANSCRIPT_URL || 'http://127.0.0.1:9090/transcript';

// // If you ever run on Node <18, uncomment the next line and `npm i node-fetch`
// // global.fetch = global.fetch || require('node-fetch');

// async function postTranscriptToCore({ sessionId, text, isFinal = false, speaker = 'candidate' }) {
//   if (!text) return;
//   try {
//     await fetch(CORE_TRANSCRIPT_URL, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json' },
//       body: JSON.stringify({
//         session_id: sessionId,
//         text,
//         is_final: !!isFinal,
//         speaker,
//         ts: Date.now()
//       }),
//     });
//   } catch (e) {
//     console.error('[stt] core post failed:', e.message);
//   }
// }

// // ---- ffmpeg path ----
// try {
//   const bin = which.sync('ffmpeg');
//   ffmpeg.setFfmpegPath(bin);
//   console.log('[relay] ffmpeg:', bin);
// } catch {
//   console.warn('[relay] ffmpeg not found in PATH; fluent-ffmpeg may fail');
// }

// const app = express();
// app.use(express.json({ limit: '2mb' }));
// app.use(cors());

// // optional static
// const filesDir = path.join(__dirname, 'files');
// if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir);
// app.use('/files', express.static(filesDir, { setHeaders: (res)=>res.set('Access-Control-Allow-Origin','*') }));

// // -----------------------------------------------------------
// // TTS
// // -----------------------------------------------------------

// const ttsSessions = new Map(); // id -> { clients:Set<ws>, kill:fn|null, playing:boolean }
// const ensureTtsSession = id =>
//   ttsSessions.get(id) || ttsSessions.set(id, { clients:new Set(), kill:null, playing:false }).get(id);

// // Send control frames as **text** (fixes browser treating them as PCM)
// const ttsCtrl = (s,obj)=>{ const txt = JSON.stringify(obj);
//   for (const ws of s.clients) if (ws.readyState===1) ws.send(txt);
// };
// // PCM frames remain binary
// const ttsPcm  = (s,buf)=>{ for (const ws of s.clients) if (ws.readyState===1) ws.send(buf); };

// function streamMp3ToPcmFrames(mp3Stream, onFrame, onEnd, onError) {
//   const pcmStream = new PassThrough();
//   const proc = ffmpeg(mp3Stream)
//     .noVideo()
//     .audioCodec('pcm_s16le')
//     .audioChannels(1)
//     .audioFrequency(48000)
//     .format('s16le')
//     .on('start', cmd => console.log('[relay] ffmpeg start:', cmd))
//     .on('error', err => onError(err))
//     .on('end',   () => onEnd())
//     .pipe(pcmStream, { end: true });

//   let carry = Buffer.alloc(0);
//   let frames = 0, bytes = 0;
//   const BYTES=2, SAMPLES=960, FRAME=SAMPLES*BYTES; // 20ms @48k

//   pcmStream.on('data', chunk => {
//     let data = Buffer.concat([carry, chunk]);
//     let off = 0;
//     while (data.length - off >= FRAME) {
//       const slice = data.slice(off, off + FRAME);
//       onFrame(slice); frames++; bytes += slice.length;
//       off += FRAME;
//     }
//     carry = data.slice(off);
//   });

//   const finish = () => setTimeout(() => {
//     console.log(`[relay] ffmpeg done: ${frames} frames, ${bytes} bytes (~${(frames*20/1000).toFixed(2)}s)`);
//   }, 10);
//   proc.on('end', finish);

//   return proc;
// }

// async function elevenlabsMp3(text, voiceId) {
//   if (!ELEVENLABS_API_KEY) throw new Error('Missing ELEVENLABS_API_KEY');
//   const vid = voiceId || ELEVENLABS_VOICE_ID; if (!vid) throw new Error('Missing ELEVENLABS_VOICE_ID');

//   const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}`;
//   const resp = await fetch(url, {
//     method: 'POST',
//     headers: {
//       'xi-api-key': ELEVENLABS_API_KEY,
//       'Content-Type': 'application/json',
//       'Accept': 'audio/mpeg'
//     },
//     body: JSON.stringify({
//       text,
//       model_id: ELEVENLABS_MODEL_ID,
//       optimize_streaming_latency: 2,
//       voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true }
//     })
//   });

//   if (!resp.ok) {
//     const errText = await resp.text().catch(()=> '');
//     throw new Error(`ElevenLabs ${resp.status}: ${errText.slice(0,200)}`);
//   }
//   if (!resp.body) throw new Error('No response body from ElevenLabs');

//   return Readable.fromWeb(resp.body);
// }

// app.post('/speak', async (req,res) => {
//   try {
//     const { session_id, text, voice_id } = req.body || {};
//     if (!session_id || !text) return res.status(422).json({ error: 'session_id and text required' });

//     const s = ensureTtsSession(session_id);
//     if (s.clients.size === 0) {
//       return res.status(409).json({ error: 'no bot connected for this session_id' });
//     }

//     if (s.playing && s.kill) { try { s.kill(); } catch {} }
//     s.playing = true;

//     console.log(`[relay] speak: sid=${session_id} clients=${s.clients.size} text="${String(text).slice(0,60)}"`);
//     const mp3 = await elevenlabsMp3(text, voice_id);

//     ttsCtrl(s, { type:'start', session_id });
//     let sent = 0;
//     const proc = streamMp3ToPcmFrames(
//       mp3,
//       (frame) => { sent++; ttsPcm(s, frame); },
//       () => { s.playing=false; s.kill=null; ttsCtrl(s, { type:'end', session_id }); console.log(`[relay] stream finished: ${sent} frames`); },
//       (err) => { s.playing=false; s.kill=null; ttsCtrl(s, { type:'error', session_id, detail:String(err) }); console.error('[relay] ffmpeg error:', err); }
//     );
//     s.kill = () => { try { proc.kill('SIGKILL'); } catch {} };

//     res.status(202).json({ accepted:true, session_id });
//   } catch (e) {
//     console.error('[relay] speak error:', e);
//     res.status(500).json({ error: String(e) });
//   }
// });

// app.post('/interrupt', (req,res) => {
//   const { session_id } = req.body || {};
//   if (!session_id) return res.status(422).json({ error: 'session_id required' });
//   const s = ttsSessions.get(session_id);
//   if (s?.kill) { try { s.kill(); } catch {} s.kill=null; s.playing=false; ttsCtrl(s, { type:'interrupted', session_id }); console.log('[relay] interrupted', session_id); }
//   res.status(204).end();
// });

// // -----------------------------------------------------------
// // STT (Deepgram)
// // -----------------------------------------------------------

// function deepgramWsUrl() {
//   const q = new URLSearchParams({
//     encoding: 'linear16',
//     sample_rate: '16000',
//     channels: '1',
//     smart_format: 'true',
//     punctuate: STT_PUNCTUATE,
//     diarize: STT_DIARIZE,
//     endpointing: STT_ENDPOINTING,
//     utterances: STT_UTTERANCES,
//     language: STT_LANGUAGE,
//   });
//   return `wss://api.deepgram.com/v1/listen?${q.toString()}`;
// }

// const sttSessions = new Map(); // id -> { id, clients:Set<ws>, dg:WebSocket|null, senderCount:number }

// function openDeepgram(session) {
//   if (!DG_KEY) { console.warn('[stt] Missing DEEPGRAM_API_KEY; STT disabled'); return; }

//   const url = deepgramWsUrl();
//   const dg = new WebSocket(url, { headers: { Authorization: `Token ${DG_KEY}` } });

//   dg.on('open', () => console.log(`[stt] DG connected for ${session.id}`));

//   dg.on('message', (data) => {
//     try {
//       const msg = JSON.parse(data.toString());
//       if (msg.type === 'Results' && msg.channel?.alternatives?.length) {
//         const alt = msg.channel.alternatives[0];
//         const text = alt.transcript || '';
//         const is_final = !!msg.channel.is_final;
//         if (text) {
//           const out = JSON.stringify({
//             type: 'transcript',
//             session_id: session.id,
//             is_final,
//             text,
//             confidence: alt.confidence ?? null,
//             words: alt.words ?? null,
//           });
//           for (const ws of session.clients) {
//             if (ws.readyState === WebSocket.OPEN) ws.send(out);
//           }
//           // NEW: persist to local core (Option B)
//           postTranscriptToCore({ sessionId: session.id, text, isFinal: is_final, speaker: 'candidate' });

//           if (is_final) console.log(`[stt][${session.id}] ${text}`);
//         }
//       }
//     } catch (e) {
//       console.warn('[stt] DG parse error:', e);
//     }
//   });

//   dg.on('close', () => console.log(`[stt] DG closed for ${session.id}`));
//   dg.on('error', (err) => console.error('[stt] DG error:', err));
//   session.dg = dg;
// }

// // -----------------------------------------------------------
// // HTTP server + unified WS upgrade router (/ws/stt and /audio)
// // -----------------------------------------------------------

// const server = http.createServer(app);

// // WS servers in noServer mode
// const sttWss = new WebSocketServer({ noServer: true });
// const ttsWss = new WebSocketServer({ noServer: true });

// // STT per-connection wiring
// sttWss.on('connection', (ws) => {
//   let session = null;
//   let role = 'listener';

//   ws.on('message', (data, isBinary) => {
//     if (!session) {
//       try {
//         const m = JSON.parse(isBinary ? data.toString() : data);
//         if (m?.type !== 'join' || !m?.session_id) {
//           ws.close(1008, 'First message must be join with session_id');
//           return;
//         }
//         role = m.role === 'sender' ? 'sender' : 'listener';
//         const id = String(m.session_id);

//         if (!sttSessions.has(id)) {
//           sttSessions.set(id, { id, clients: new Set(), dg: null, senderCount: 0 });
//         }
//         session = sttSessions.get(id);
//         session.clients.add(ws);
//         if (role === 'sender') session.senderCount += 1;

//         if (!session.dg) openDeepgram(session);

//         ws.send(JSON.stringify({ type: 'joined', session_id: id, role }));
//         console.log(`[stt] client joined ${id} as ${role}`);
//       } catch {
//         ws.close(1008, 'Bad join payload');
//       }
//       return;
//     }

//     if (role === 'sender' && isBinary) {
//       if (session?.dg?.readyState === WebSocket.OPEN) {
//         session.dg.send(data, { binary: true });
//       }
//       return;
//     }
//   });

//   ws.on('close', () => {
//     if (!session) return;
//     session.clients.delete(ws);
//     if (role === 'sender') session.senderCount = Math.max(0, session.senderCount - 1);
//     if (session.clients.size === 0) {
//       try { session.dg?.close(); } catch {}
//       sttSessions.delete(session.id);
//       console.log(`[stt] session ${session.id} closed`);
//     }
//   });
// });

// // Unified upgrade router
// server.on('upgrade', (req, socket, head) => {
//   try {
//     const u = new URL(req.url, `http://${RELAY_HOST}:${RELAY_PORT}`);

//     if (u.pathname === '/ws/stt') {
//       sttWss.handleUpgrade(req, socket, head, (ws) => {
//         sttWss.emit('connection', ws, req);
//       });
//       return;
//     }

//     if (u.pathname === '/audio') {
//       const sessionId = u.searchParams.get('session');
//       if (!sessionId) {
//         socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
//         socket.destroy();
//         return;
//       }
//       ttsWss.handleUpgrade(req, socket, head, (ws) => {
//         const s = ensureTtsSession(sessionId);
//         s.clients.add(ws);
//         ws.on('close', () => s.clients.delete(ws));
//         ws.send(JSON.stringify({ type:'hello', session_id:sessionId, sample_rate_hz:48000 }));
//         console.log('[relay] /audio ws joined', sessionId, 'clients=', s.clients.size);
//       });
//       return;
//     }

//     socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
//     socket.destroy();
//   } catch (e) {
//     console.warn('[relay] upgrade error:', e?.message || e);
//     try { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
//     try { socket.destroy(); } catch {}
//   }
// });

// // Health
// app.get('/health', (_req,res)=>res.status(200).json({ ok:true, ts:Date.now() }));
// app.get('/healthz', (_req,res)=>res.status(200).json({ ok:true }));

// // Start
// server.listen(RELAY_PORT, RELAY_HOST, () => {
//   console.log(`[relay] http://${RELAY_HOST}:${RELAY_PORT} (STT + TTS unified)`);
// });

