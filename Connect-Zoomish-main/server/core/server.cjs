// server.cjs — app static + signaling + TURN REST creds + JWT-gated roles + Meetings API

// --- load env early ---
try { require('dotenv').config({ path: process.env.ENVFILE || '.env' }); } catch (_) { }

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Server } = require('socket.io');

// === JWT + UUID ===
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// ----------- ENV -----------
const PORT = process.env.PORT || 3001;

// TURN_SECRET=d5ce87d42b01ca74a3054428d621b5cd8411a3a7287f48910e4d9f;
const TURN_SECRET = process.env.TURN_SECRET; // REQUIRED
const TURN_HOST = process.env.TURN_HOST || 'turn.airahr.ai';
const TURN_REALM = process.env.TURN_REALM || 'turn.airahr.ai';
const TURN_TTL = parseInt(process.env.TURN_TTL || '3600', 10);
const STATUS_TOKEN = process.env.STATUS_TOKEN || '';
// Minutes before scheduled start that a candidate may join (default 10)
const EARLY_JOIN_MIN = parseInt(process.env.EARLY_JOIN_MIN || '10', 10);
// Minutes after scheduled start beyond which a candidate cannot join (default 10)
const LATE_JOIN_AFTER_MIN = parseInt(process.env.LATE_JOIN_AFTER_MIN || '10', 10);
// Toggle: if true, enforce the late-join rule above; if false, allow joining any time before token exp
const RESTRICT_LATE_JOIN = String(process.env.RESTRICT_LATE_JOIN || 'false').toLowerCase() === 'true';

/** JWT secret for role-gated access */
const AIRA_JWT_SECRET = process.env.AIRA_JWT_SECRET || '';
/** Optional: base URL for invite links; if not set, links use request host */
const AIRA_BASE_URL = (process.env.AIRA_BASE_URL || '').replace(/\/+$/, '');
/** Optional default invite TTL (minutes) */
const AIRA_INVITE_TTL_MIN = parseInt(process.env.AIRA_INVITE_TTL_MIN || '180', 10);

// --- compatibility shim for meetings router (run BEFORE requiring it) ---
if (!process.env.JWT_SECRET && process.env.AIRA_JWT_SECRET) {
  process.env.JWT_SECRET = process.env.AIRA_JWT_SECRET;
}
if (!process.env.CLIENT_ORIGIN) {
  process.env.CLIENT_ORIGIN = process.env.AIRA_BASE_URL || 'https://aira.airahr.ai';
}
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'dev-airakey1234';


if (!TURN_SECRET) { throw new Error('env TURN_SECRET is required'); }
if (!AIRA_JWT_SECRET) {
  console.warn('WARN: AIRA_JWT_SECRET not set — JWT invite APIs will reject requests.');
}

const app = express();
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: true, credentials: true } });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.raw({ type: 'application/octet-stream', limit: '200mb' }));

// Log policy toggles for quick verification at startup
try {
  console.log(`[policy] EARLY_JOIN_MIN=${EARLY_JOIN_MIN}, LATE_JOIN_AFTER_MIN=${LATE_JOIN_AFTER_MIN}, RESTRICT_LATE_JOIN=${RESTRICT_LATE_JOIN}, ALLOW_GUEST_JOIN=${ALLOW_GUEST_JOIN}`);
} catch { }

// Simple RTT -> quality classifier (keep in sync with client thresholds)
function rttLevel(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'unknown';
  if (ms <= 150) return 'good';
  if (ms <= 400) return 'ok';
  return 'poor';
}

// === mount REST routers (require AFTER env shim) ===
const meetingsApi = require(path.join(__dirname, '..', 'api', 'meetings.cjs')); // bullet-proof path
app.use('/api', meetingsApi); // adds POST /api/meetings

// ---- static client (vite build) ----
const DIST = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get('/', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// ===================== TURN REST creds =====================
app.get('/turn-credentials', (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TURN_TTL;
  const username = `${exp}:browser`;
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  res.json({
    username, credential, ttl: TURN_TTL, realm: TURN_REALM,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: [`turn:${TURN_HOST}:3478?transport=udp`, `turn:${TURN_HOST}:3478?transport=tcp`], username, credential }
    ]
  });
});

// ===================== tiny auth for status API =====================
function statusAuth(req, res, next) {
  if (!STATUS_TOKEN) return next();
  const tok = req.get('X-Status-Token') || req.query.token;
  if (tok === STATUS_TOKEN) return next();
  res.status(401).json({ error: 'unauthorized' });
}

// ===================== ROOMS STATE =====================
/**
 * rooms: Map<roomId, {
 *   startMs:number,
 *   lastActive:number,
 *   participants: Map<socketId,{name,role,muted,videoOff}>,
 *   roles: {
 *     bot:       { jti:string|null, sid:string|null },
 *     candidate: { jti:string|null, sid:string|null },
 *     recruiter: { jti:string|null, sid:string|null },
 *   }
 * }>
 */
const VALID_ROLES = ['bot', 'candidate', 'recruiter', 'Sentinel'];
const rooms = new Map();

function ensureRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      startMs: 0,
      lastActive: 0,
      endedAt: 0,
      endReason: '',
      participants: new Map(),
      chats: [],
      roles: {
        bot: { jti: null, sid: null },
        candidate: { jti: null, sid: null },
        recruiter: { jti: null, sid: null },
        Sentinel: { jti: null, sid: null },
      }
    });
  }
  return rooms.get(id);
}

const getRoom = (id) => ensureRoom(id);

const snapshot = (roomId) => {
  const r = rooms.get(roomId);
  if (!r) return { participants: [], locked: false, chatEnabled: true, startMs: null };

  const participants = [...r.participants.entries()].map(([id, p]) => ({ id, ...p }));
  const locked = VALID_ROLES.every(role => Boolean(r.roles[role].jti));

  return {
    participants,
    locked,
    chatEnabled: true,
    startMs: r.startMs || null
  };
};


// ===================== STATUS endpoints =====================
app.get('/api/rooms', statusAuth, (_req, res) => {
  res.json({
    rooms: [...rooms.entries()].map(([id, r]) => ({
      roomId: id, startMs: r.startMs, lastActive: r.lastActive, count: r.participants.size
    }))
  });
});

app.get('/api/rooms/:id', statusAuth, (req, res) => {
  const r = rooms.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json({
    roomId: req.params.id, startMs: r.startMs, lastActive: r.lastActive, count: r.participants.size,
    participants: [...r.participants.entries()].map(([sid, p]) => ({ id: sid, ...p })),
    roles: r.roles
  });
});

// Simple config inspector to verify runtime policy values
app.get('/api/policy', statusAuth, (_req, res) => {
  res.json({
    EARLY_JOIN_MIN,
    LATE_JOIN_AFTER_MIN,
    RESTRICT_LATE_JOIN
  });
});

// Open policy endpoint for client (no auth)
app.get('/api/policy-open', (_req, res) => {
  res.json({
    EARLY_JOIN_MIN,
    LATE_JOIN_AFTER_MIN,
    RESTRICT_LATE_JOIN
  });
});

// ===================== Invite minting & validation APIs =====================
function inferBaseUrl(req) {
  if (AIRA_BASE_URL) return AIRA_BASE_URL;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}`;
}

app.post('/api/invites', (req, res) => {
  if (!AIRA_JWT_SECRET) return res.status(500).json({ error: 'JWT disabled: set AIRA_JWT_SECRET' });
  const { roomId, ttlMinutes } = req.body || {};
  if (!roomId) return res.status(400).json({ error: 'roomId required' });
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.max(60, (parseInt(ttlMinutes || AIRA_INVITE_TTL_MIN, 10) || AIRA_INVITE_TTL_MIN) * 60);
  const base = inferBaseUrl(req);

  const make = (role) => {
    const jti = uuidv4();
    const nbf = Number(req.body?.nbf) || now; // seconds since epoch
    const token = jwt.sign(
      { iss: 'aira', aud: 'webrtc', roomId, role, jti, iat: now, nbf, exp },
      AIRA_JWT_SECRET, { algorithm: 'HS256' }
    );
    return { role, jti, exp, url: `${base}/?t=${encodeURIComponent(token)}` };
  };

  res.json({
    roomId, exp,
    bot: make('bot'),
    candidate: make('candidate'),
    recruiter: make('recruiter'),
    Sentinel: make('Sentinel')
  });
});

app.get('/api/validate', (req, res) => {
  const t = req.query.t;
  if (!t) return res.status(400).json({ error: 'missing token' });
  try {
    const p = jwt.verify(t, AIRA_JWT_SECRET, { ignoreNotBefore: true });
    if (!p.roomId || !p.role || !p.jti) throw new Error('claims missing');
    if (!VALID_ROLES.includes(p.role)) throw new Error('invalid role');
    const room = ensureRoom(p.roomId);
    const slot = room.roles[p.role];
    const nowSec = Math.floor(Date.now() / 1000);
    const early = typeof p.nbf === 'number' && nowSec < p.nbf;
    res.json({
      ok: true, roomId: p.roomId, role: p.role,
      scheduledStart: p.nbf || null,
      early,
      alreadyBoundToSameToken: Boolean(slot.jti && slot.jti === p.jti),
      activePeers: room.participants.size,
      ended: Boolean(room.endedAt),
      endReason: room.endReason || null
    });
  } catch (e) {
    res.status(401).json({ error: 'invalid token', detail: e.message });
  }
});

// ------- api call for ending meeting for all------------------------
// POST /api/meeting/:roomId/end
app.post("/api/meeting/:roomId/end", async (req, res) => {
  const { roomId } = req.params;

  try {
    //  Broadcast to all participants
    io.to(roomId).emit("meeting:ended", { reason: "Bot engine marked meeting ended" });

    //  Kick remaining participants
    const r = ensureRoom(roomId);
    // Mark the room as ended (prevents any future joins for this roomId)
    r.endedAt = Date.now();
    r.endReason = "meeting_over";
    if (r) {
      for (const [sid] of r.participants) {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit("kicked", { reason: "meeting_over" });
          s.disconnect(true);
        }
      }
      // Clear active bindings but keep room state so future joins are blocked
      r.participants.clear();
      if (r && r.roles && typeof r.roles === 'object') {
        for (const role of Object.values(r.roles)) {
          if (role && Object.prototype.hasOwnProperty.call(role, 'sid')) {
            role.sid = null;
          }
        }
      }
    }

    //  Respond to caller (bot engine)
    res.json({ success: true, message: `Meeting ${roomId} ended` });

  } catch (err) {
    console.error("Error ending meeting:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ===================== SOCKET.IO AUTH MIDDLEWARE =====================
io.use((socket, next) => {
  try {
    const t = socket.handshake.auth?.t || socket.handshake.query?.t;
    if (!t) return next(new Error('missing token'));
    if (!AIRA_JWT_SECRET) return next(new Error('JWT disabled'));
    // Allow sockets to connect even if token nbf is in the future.
    // We still verify signature/exp here and enforce the early-join window in the join handler.
    const p = jwt.verify(String(t), AIRA_JWT_SECRET, { ignoreNotBefore: true });
    if (!p.roomId || !p.role || !p.jti) return next(new Error('token claims missing'));
    if (!VALID_ROLES.includes(p.role)) return next(new Error('invalid role'));
    // Persist schedule claims if present (nbf/exp are seconds since epoch)
    socket.data.auth = { roomId: p.roomId, role: p.role, jti: p.jti, nbf: p.nbf || null, exp: p.exp || null };
    return next();
  } catch (e) {
    return next(new Error('unauthorized: ' + e.message));
  }
});

// ===================== SIGNALING =====================
io.on('connection', (socket) => {
  let currentRoom = null;

  function canBindRole(room, role, jti, sid) {
    const slot = room.roles[role];
    if (slot.jti && slot.jti !== jti) return { ok: false, reason: 'role_taken' };
    const activeRoleCount = VALID_ROLES.filter(r => Boolean(room.roles[r].sid)).length;
    const joiningNewSlot = !slot.sid;
    if (joiningNewSlot && activeRoleCount >= VALID_ROLES.length) {
      return { ok: false, reason: 'room_full' };
    }
    return { ok: true };
  }

  socket.on('join', ({ roomId, name, role, consent }) => {
    const auth = socket.data.auth || {};
    const tokenRoom = auth.roomId || roomId || 'demo-room';
    const tokenRole = auth.role;
    const tokenJti = auth.jti || null;

    currentRoom = tokenRoom;
    const r = getRoom(currentRoom);
    try { console.log('Current participants in room:', currentRoom, [...r.participants.values()]); } catch { }
    // If the meeting has been ended early, deny all joins (any role)
    if (r.endedAt && r.endedAt > 0) {
      socket.emit('join-denied', { reason: 'too_late', message: 'This meeting has already ended.' });
      return;
    }

    const now = Date.now();
    const scheduledStartMs = (auth.nbf ? Number(auth.nbf) * 1000 : null);
    const expMs = (auth.exp ? Number(auth.exp) * 1000 : null);
    // If user joins before nbf, allow join but send a non-blocking notice.
    if (scheduledStartMs != null && now < scheduledStartMs) {
      socket.emit('join-denied', {
        reason: 'early_join',
        scheduledStartMs,
        message: `You can only join ${EARLY_JOIN_MIN} minutes before the scheduled meeting.`
      });
      return;
    }

    if (tokenRole === 'candidate' && consent === false) {
      socket.emit('join-denied', { reason: 'consent_required' });
      return;
    }
    // If another candidate is already present, prompt this socket to confirm replacement
    if (tokenRole === 'candidate') {
      const existing = [...r.participants.entries()].find(([sid, p]) => p.role === 'candidate' && sid !== socket.id);
      if (existing) {
        socket.data.pendingJoin = {
          roomId: currentRoom,
          name: (name).trim(),
          consent: consent !== false,
          jti: tokenJti
        };
        try { console.log('[server] duplicate_candidate -> NEW socket', socket.id, 'room', currentRoom); } catch { }
        socket.emit('duplicate_candidate', { roomId: currentRoom });
        return; // wait for client 'force_join'
      }
    }
    // Enforce schedule window using token claims (nbf/exp) if present
    if (tokenRole === 'candidate') {
      // const now = Date.now();
      // const scheduledStartMs = (auth.nbf ? Number(auth.nbf) * 1000 : null);
      // const expMs = (auth.exp ? Number(auth.exp) * 1000 : null);
      // const earliest = (scheduledStartMs != null) ? (scheduledStartMs - (EARLY_JOIN_MIN * 60_000)) : null;
      // if (earliest != null && now < earliest) {
      //   socket.emit('join-denied', {
      //     reason: 'too_early',
      //     message: `You can only join ${EARLY_JOIN_MIN} minutes before the scheduled meeting.`
      //   });
      //   return;
      // }
      // Disallow joining if more than LATE_JOIN_AFTER_MIN minutes past start.
      // Prefer scheduled start time from token; else fall back to existing room start time.
      const lateBaseMs = (scheduledStartMs != null) ? scheduledStartMs : (r.startMs || null);
      if (RESTRICT_LATE_JOIN && lateBaseMs != null && now > (lateBaseMs + LATE_JOIN_AFTER_MIN * 60_000)) {
        socket.emit('join-denied', {
          reason: 'too_late',
          message: `You can’t join now — the session started over ${LATE_JOIN_AFTER_MIN} minutes ago`
        });
        return;
      }
      if (expMs != null && now > expMs) {
        socket.emit('join-denied', {
          reason: 'too_late',
          message: 'This meeting has already ended.'
        });
        return;
      }
    }



    const { ok, reason } = canBindRole(r, tokenRole, tokenJti, socket.id);
    if (!ok) {
      socket.emit('join-denied', { reason });
      return;
    }

    if (tokenRole === 'bot' && !r.startMs) {
      r.startMs = Date.now();
      console.log(`[timer] Bot joined, starting timer for room ${currentRoom} at ${r.startMs}`);
      // Broadcast to everyone already in the room
      io.to(currentRoom).emit('room:timer', { startMs: r.startMs, now: Date.now() });
    }
    r.lastActive = Date.now();
    if (auth.nbf) r.nbf = Number(auth.nbf);
    if (auth.exp) r.exp = Number(auth.exp);

    const joinTimestamp = Date.now();

    r.roles[tokenRole].jti = tokenJti;
    r.roles[tokenRole].sid = socket.id;

    const me = { name: (name || '').trim(), role: tokenRole, muted: false, videoOff: false, joinTimestamp };
    r.participants.set(socket.id, me);
    socket.join(currentRoom);

    // If Sentinel joined, tell candidate to send re-offer
    if (tokenRole === 'Sentinel') {
      // const candEntry = [...r.participants.entries()].find(([_, p]) => p.role === 'candidate');
      // if (candEntry) {
      //   const [candSid] = candEntry;
      //   const candSock = io.sockets.sockets.get(candSid);
      //   if (candSock) {
      //     console.log(`[signaling] Sentinel joined -> asking candidate ${candSid} to re-offer`);
      //     candSock.emit('sentinel:joined', { sentinelId: socket.id });
      //   }
      // }
      console.log(`[signaling] Sentinel joined (${socket.id}) — notifying peers to re-offer`);

      for (const [peerSid, peer] of r.participants.entries()) {
        // Skip the sentinel itself
        if (peerSid === socket.id) continue;

        const role = (peer.role || '').toLowerCase();
        if (role === 'sentinel') continue; // redundant guard

        const peerSocket = io.sockets.sockets.get(peerSid);
        if (peerSocket) {
          console.log(`[signaling] -> requesting re-offer from ${peerSid} (${role})`);
          peerSocket.emit('sentinel:joined', { sentinelId: socket.id });
        }
      }
    }

    const others = [...r.participants.keys()].filter(id => id !== socket.id);
    socket.emit('room:timer', { startMs: r.startMs, now: Date.now() });
    socket.emit('join-ok', { roomId: currentRoom, others, startMs: r.startMs });
    // send chat history to the newly joined socket
    try { socket.emit('chat:history', { messages: (r.chats || []).slice(-200) }); } catch { }

    io.to(currentRoom).emit('presence', { type: 'joined', socketId: socket.id, name: me.name, role: me.role });
    io.to(currentRoom).emit('room:state', snapshot(currentRoom));
    // saveRoomsToFile();
  });

  // (optional) global logger to verify incoming events
  socket.onAny((event, ...args) => { try { console.log('[server] onAny', event, args?.[0] ?? '(no args)'); } catch { } });

  // Allow candidate to forcefully replace an existing candidate with the same invite
  socket.on('force_join', ({ roomId: reqRoom } = {}) => {
    const auth = socket.data.auth || {};
    if (auth.role !== 'candidate') return; // only candidates use this path
    // Prefer explicit roomId from client, else fallback to auth
    const roomId = reqRoom || auth.roomId;
    const r = getRoom(roomId);
    // Deny if meeting has ended
    if (r.endedAt && r.endedAt > 0) {
      socket.emit('join-denied', { reason: 'too_late', message: 'This meeting has already ended.' });
      return;
    }
    if (!r) return;
    try { console.log('[server] force_join from', socket.id, 'room', roomId); } catch { }

    // 1) Kick old candidate if still present
    const existing = [...r.participants.entries()]
      .find(([sid, p]) => p.role === 'candidate' && sid !== socket.id);
    if (existing) {
      const [oldSid] = existing;
      const oldSocket = io.sockets.sockets.get(oldSid);
      try { console.log('[server] kicking old candidate', oldSid); } catch { }
      if (oldSocket) {
        oldSocket.emit('kicked', { reason: 'You joined from another browser or tab, hence this session is disconnected' });
        try { oldSocket.disconnect(true); } catch { }
      }
      r.participants.delete(oldSid);
      if (r.roles.candidate.sid === oldSid) r.roles.candidate.sid = null;
      io.to(roomId).emit('room:state', snapshot(roomId));
    }

    // 2) Complete admission for this socket (mirror join-ok path)
    const pending = socket.data.pendingJoin || {};
    const name = (pending.name || '').trim();
    const consent = pending.consent !== false;
    if (!consent) {
      try { console.log('[server] force_join denied: consent_required'); } catch { }
      socket.emit('join-denied', { reason: 'consent_required' });
      return;
    }
    r.roles.candidate.jti = pending.jti || auth.jti || null;
    r.roles.candidate.sid = socket.id;
    if (auth.role === 'bot' && !r.startMs) {
      r.startMs = Date.now();
      console.log(`[timer] Bot force-joined, starting timer at ${r.startMs}`);
    }

    r.lastActive = Date.now();
    const me = { name, role: 'candidate', muted: false, videoOff: false };
    r.participants.set(socket.id, me);
    socket.join(roomId);
    const others = [...r.participants.keys()].filter(id => id !== socket.id);
    try { console.log('[server] force_join completed, admitting', socket.id, 'others:', others.length); } catch { }
    socket.emit('room:timer', { startMs: r.startMs, now: Date.now() });
    socket.emit('join-ok', { roomId, others, startMs: r.startMs });
    try { socket.emit('chat:history', { messages: (r.chats || []).slice(-200) }); } catch { }
    io.to(roomId).emit('presence', { type: 'joined', socketId: socket.id, name: me.name, role: me.role });
    io.to(roomId).emit('room:state', snapshot(roomId));
    delete socket.data.pendingJoin;
  });

  socket.on('presence:update', ({ name }) => {
    if (!currentRoom) return;
    const r = rooms.get(currentRoom); if (!r) return;
    const me = r.participants.get(socket.id); if (!me) return;
    if (name && name.trim()) me.name = name.trim();
    r.lastActive = Date.now();
    io.to(currentRoom).emit('presence:update', { id: socket.id, name: me.name });
    io.to(currentRoom).emit('room:state', snapshot(currentRoom));
  });

  socket.on('presence:av', ({ muted, videoOff }) => {
    if (!currentRoom) return;
    const r = rooms.get(currentRoom); if (!r) return;
    const me = r.participants.get(socket.id); if (!me) return;
    if (typeof muted === 'boolean') me.muted = muted;
    if (typeof videoOff === 'boolean') me.videoOff = videoOff;
    r.lastActive = Date.now();
    io.to(currentRoom).emit('room:state', snapshot(currentRoom));
  });

  // WebRTC relay
  socket.on('webrtc:offer', ({ to, sdp }) => io.to(to).emit('webrtc:offer', { from: socket.id, sdp }));
  socket.on('webrtc:answer', ({ to, sdp }) => io.to(to).emit('webrtc:answer', { from: socket.id, sdp }));
  socket.on('webrtc:ice', ({ to, ice }) => io.to(to).emit('webrtc:ice', { from: socket.id, ice }));

  // Chat
  socket.on('chat:send', ({ roomId, message }) => {
    const r = rooms.get(roomId || currentRoom); if (!r) return;
    const me = r.participants.get(socket.id) || { name: '', role: '' };
    const msg = { name: me.name, role: me.role, message, ts: Date.now() };
    io.to(roomId || currentRoom).emit('chat:recv', msg);
    try {
      if (!Array.isArray(r.chats)) r.chats = [];
      r.chats.push(msg);
      if (r.chats.length > 500) r.chats.splice(0, r.chats.length - 500);
    } catch { }
  });

  // clean leave helper — perform cleanup for a given roomId
  function leave(roomId) {
    const r = rooms.get(roomId);
    if (!r) return;

    const auth = socket.data.auth || {};
    const role = auth.role;

    // If this socket was bound to a role, unbind the sid
    if (role && r.roles[role] && r.roles[role].sid === socket.id) {
      r.roles[role].sid = null;
    }

    // Record the leave time for the participant
    const participant = r.participants.get(socket.id);
    if (participant) {
      participant.leaveTimestamp = Date.now();  // Store leave timestamp
    }

    // Remove participant record
    r.participants.delete(socket.id);
    r.lastActive = Date.now();

    // 🧹 Reset room when empty (timer restarts on next join)
    if (r.participants.size === 0) {
      r.startMs = 0;
      r.chats = [];
      r.roles = {
        bot: { jti: null, sid: null },
        candidate: { jti: null, sid: null },
        recruiter: { jti: null, sid: null },
        Sentinel: { jti: null, sid: null }
      };
    }

    // Broadcast updates
    socket.leave(roomId);
    io.to(roomId).emit("presence", { type: "left", socketId: socket.id });
    io.to(roomId).emit("room:state", snapshot(roomId));
    // saveRoomsToFile();
  }

  // Register public handlers that call the helper
  socket.on('leave', ({ roomId }) => leave(roomId || currentRoom));
  socket.on('disconnect', () => { if (currentRoom) leave(currentRoom); });

  // Internet quality lightweight RTT echo + broadcast
  socket.on('net:ping', ({ t } = {}) => {
    try { console.log('[net] ping from', socket.id, 't=', t); } catch { }
    try { socket.emit('net:pong', { t }); } catch { }
  });
  socket.on('net:self', (payload = {}) => {
    if (!currentRoom) return;
    const rttMs = Number(payload?.rttMs);
    const level = String(payload?.level || rttLevel(rttMs));
    const now = Date.now();
    // Throttle to avoid noisy logs: 1 event / 10s per socket
    const last = socket.data?._lastPoorNetLog || 0;
    const r = rooms.get(currentRoom);
    const me = r?.participants?.get?.(socket.id) || { name: '', role: '' };
    const severe = (level === 'poor') || (!Number.isFinite(rttMs) && level !== 'good' && level !== 'ok');
    if (severe && (now - last) > 10_000) {
      try {
        console.warn('[net] poor-connection', {
          roomId: currentRoom,
          socketId: socket.id,
          name: me.name || '',
          role: me.role || '',
          rttMs: Number.isFinite(rttMs) ? rttMs : null,
          level,
          downlink: payload?.downlink,
          effectiveType: payload?.effectiveType
        });
      } catch { }
      if (!socket.data) socket.data = {};
      socket.data._lastPoorNetLog = now;
    }
    // Broadcast this socket's internet signal snapshot to the room
    try { io.to(currentRoom).emit('net:peer', { id: socket.id, ...payload, level }); } catch { }
  });
});

// ---- health ----
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

srv.listen(PORT, () => console.log(`Signaling listening on :${PORT}`));
