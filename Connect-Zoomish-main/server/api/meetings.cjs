// server/api/meetings.cjs
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { DateTime } = require('luxon');


const router = express.Router();

// ---- Config from env (simple reads; no destructuring) ----
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV_ONLY';
const JWT_AUD = process.env.JWT_AUD || 'webrtc';
const JWT_ISS = process.env.JWT_ISS || 'aira';
const JWT_TTL_MINUTES = parseInt(process.env.JWT_TTL_MINUTES || '180', 10); // fallback for immediate meetings
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://aira.airahr.ai';
const ICE_SERVERS_JSON = process.env.ICE_SERVERS_JSON || '[]';

let ICE_SERVERS = [];
try { ICE_SERVERS = JSON.parse(ICE_SERVERS_JSON); } catch (_) { ICE_SERVERS = []; }

// ---- auth & limits ----
function requireAdmin(req, res, next) {
  const hdr = req.get('X-API-Key') || '';
  if (!ADMIN_API_KEY || hdr !== ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// ---- idempotency (memory) ----
const idemCache = new Map();
const IDEM_TTL_MS = 15 * 60 * 1000;

function withIdempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return next();

  const now = Date.now();
  for (const [k, v] of idemCache) if (now - v.ts > IDEM_TTL_MS) idemCache.delete(k);

  const hit = idemCache.get(key);
  if (hit) return res.status(hit.status).json(hit.body);

  const _json = res.json.bind(res);
  res.json = (payload) => {
    idemCache.set(key, { status: res.statusCode || 200, body: payload, ts: Date.now() });
    return _json(payload);
  };
  next();
}

// ---- helpers: ids, tokens, join URLs ----
function genId(prefix = 'aira') {
  const ts = new Date();
  const y = ts.getUTCFullYear();
  const m = String(ts.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ts.getUTCDate()).padStart(2, '0');
  const hh = String(ts.getUTCHours()).padStart(2, '0');
  const mm = String(ts.getUTCMinutes()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex');
  return `${prefix}-${y}${m}${d}-${hh}${mm}-${rand}`;
}

function buildJoinUrl(token, roomId, name, role) {
  let params;
  if(role==='bot'||role==='Sentinel'){
   params = new URLSearchParams({
    t: token, room: roomId, name: name || '', role: role || 'bot', auto: '1'
    });
  }
  else{
   params = new URLSearchParams({
    t: token /*, room: roomId, name: name || '', role: role || 'candidate', auto: '1'*/
    });
  }
  return `${CLIENT_ORIGIN}/?${params.toString()}`;
}

function signTokenNow({ roomId, role, name, ttlMinutes }) {
  const jti = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  const payload = { iss: JWT_ISS, aud: JWT_AUD, roomId, role, name, jti };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: `${ttlMinutes}m` });
  return { token, jti };
}

function signTokenAt({ roomId, role, name, startEpochSec, durationMin }) {
  const jti = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  const nbf = startEpochSec-600; 
  const exp = startEpochSec + (durationMin * 60);
  const iat = Math.floor(Date.now() / 1000);
  // Include explicit duration so clients can drive timers accurately
  const payload = { iss: JWT_ISS, aud: JWT_AUD, roomId, role, name, jti, iat, nbf, exp, dur: durationMin };
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
  return { token, jti, nbf, exp };
}

// ---- Timezone helpers ----
// We support two IANA TZ names explicitly; anything else falls back to UTC.
const SUPPORTED_TZ = new Set(['America/New_York', 'Asia/Kolkata', 'Asia/Singapore']);

// Minimal VTIMEZONEs that work well with major calendars
function vtimezoneBlock(tzid) {
  if (tzid === 'America/New_York') {
    return [
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'X-LIC-LOCATION:America/New_York',
      'BEGIN:DAYLIGHT',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'TZNAME:EDT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'TZNAME:EST',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'END:STANDARD',
      'END:VTIMEZONE'
    ].join('\r\n');
  }
  if (tzid === 'Asia/Kolkata') {
    return [
      'BEGIN:VTIMEZONE',
      'TZID:Asia/Kolkata',
      'X-LIC-LOCATION:Asia/Kolkata',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:+0530',
      'TZOFFSETTO:+0530',
      'TZNAME:IST',
      'DTSTART:19700101T000000',
      'END:STANDARD',
      'END:VTIMEZONE'
    ].join('\r\n');
  }
  if (tzid === 'Asia/Singapore') {
  return [
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Singapore',
    'X-LIC-LOCATION:Asia/Singapore',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:+0800',
    'TZOFFSETTO:+0800',
    'TZNAME:SGT',
    'DTSTART:19700101T000000',
    'END:STANDARD',
    'END:VTIMEZONE'
  ].join('\r\n');
}
  return ''; // fallback (UTC-only ICS)
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ICS date as UTC Zulu
function icsDateUTC(ms) {
  const d = new Date(ms);
  return (
    d.getUTCFullYear().toString() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) + 'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) + 'Z'
  );
}

// Local "floating" ICS datetime for a given IANA tz (no trailing Z)
function icsDateLocal(ms, tz) {
  // Build YYYYMMDDTHHMMSS for the provided timezone using Intl API
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return (
    parts.year + parts.month + parts.day + 'T' +
    parts.hour + parts.minute + parts.second
  );
}

function escapeICS(s = '') {
  return String(s).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

// Build ICS in either UTC (default) or a specific TZID with VTIMEZONE
function buildICS({ uid, title, description, url, startMs, endMs, location = '', tzid = null }) {
  const nowUTC = icsDateUTC(Date.now());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AIRA//Interview//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  if (tzid && SUPPORTED_TZ.has(tzid)) {
    lines.push(vtimezoneBlock(tzid));
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeICS(uid)}`);
    lines.push(`DTSTAMP:${nowUTC}`);
    lines.push(`DTSTART;TZID=${tzid}:${icsDateLocal(startMs, tzid)}`);
    lines.push(`DTEND;TZID=${tzid}:${icsDateLocal(endMs, tzid)}`);
  } else {
    // UTC fallback
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeICS(uid)}`);
    lines.push(`DTSTAMP:${nowUTC}`);
    lines.push(`DTSTART:${icsDateUTC(startMs)}`);
    lines.push(`DTEND:${icsDateUTC(endMs)}`);
  }

  lines.push(`SUMMARY:${escapeICS(title)}`);
  lines.push(`DESCRIPTION:${escapeICS(description)}\\nJoin: ${escapeICS(url)}`);
  lines.push(`URL:${escapeICS(url)}`);
  if (location) lines.push(`LOCATION:${escapeICS(location)}`);
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

// Human-friendly display strings (UTC, Eastern, India)
function fmtDisplay(ms, tz) {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short'
  });
  return fmt.format(d);
}
function displayBundle(startMs, endMs) {
  return {
    utc: {
      start: fmtDisplay(startMs, 'UTC'),
      end: fmtDisplay(endMs, 'UTC'),
    },
    eastern: {
      start: fmtDisplay(startMs, 'America/New_York'),
      end: fmtDisplay(endMs, 'America/New_York'),
    },
    india: {
      start: fmtDisplay(startMs, 'Asia/Kolkata'),
      end: fmtDisplay(endMs, 'Asia/Kolkata'),
    }
  };
}

// ==================================
// 1) Immediate meetings (unchanged)
// ==================================
router.post('/meetings', requireAdmin, createLimiter, withIdempotency,  (req, res) => {
  const {
    roomId: reqRoomId,
    ttl_minutes,
    candidate_name = 'AIRA Candidate',
    recruiter_name = 'AIRA Recruiter',
    bot_name = 'AIRA Bot',
    observer_name='AIRA Sentinel',
    roles = ['candidate', 'recruiter', 'bot','Sentinel'],
    metadata = {}
  } = req.body || {};

  const ttl = Number.isFinite(+ttl_minutes) && +ttl_minutes > 0 ? +ttl_minutes : JWT_TTL_MINUTES;
  const roomId = (reqRoomId && String(reqRoomId).trim()) || genId('aira');

  const out = { roomId, iceServers: ICE_SERVERS, metadata, roles: {} };

  if (roles.includes('candidate')) {
    const { token } = signTokenNow({ roomId, role: 'candidate', name: candidate_name, ttlMinutes: ttl });
    out.roles.candidate = { name: candidate_name, token, joinUrl: buildJoinUrl(token, roomId, candidate_name, 'candidate') };
  }
  if (roles.includes('recruiter')) {
    const { token } = signTokenNow({ roomId, role: 'recruiter', name: recruiter_name, ttlMinutes: ttl });
    out.roles.recruiter = { name: recruiter_name, token, joinUrl: buildJoinUrl(token, roomId, recruiter_name, 'recruiter') };
  }
  if (roles.includes('bot')) {
    const { token } = signTokenNow({ roomId, role: 'bot', name: bot_name, ttlMinutes: ttl });
    out.roles.bot = { name: bot_name, token, joinUrl: buildJoinUrl(token, roomId, bot_name, 'bot') };
  }
  if (roles.includes('Sentinel')){
    const{token}=signTokenNow({roomId, role:'Sentinel', name: observer_name, ttlMinutes: ttl});
    out.roles.Sentinel = { name: observer_name, token, joinUrl: buildJoinUrl(token, roomId, observer_name, 'Sentinel') };
  }

  return res.status(201).json(out);
});

// ==================================
// 2) Scheduled meetings (with timezone)
// ==================================
/**
 * POST /api/meetings/schedule
 * {
 *   "roomId": "optional-fixed-id",
 *   "start_iso": "2025-09-20T14:30:00Z",   // or "2025-09-20T10:30:00-04:00"
 *   "duration_minutes": 60,
 *   "tz": "America/New_York" | "Asia/Kolkata",   // optional; ICS will use this if provided
 *   "candidate_name": "Alice",
 *   "recruiter_name": "Bob",
 *   "bot_name": "AIRA Bot",
 *   "roles": ["candidate","recruiter","bot"],
 *   "title": "AIRA Interview — Frontend",
 *   "location": "AIRA Zoomish",
 *   "metadata": {}
 * }
 */
router.post('/meetings/schedule', requireAdmin, createLimiter, withIdempotency,  (req, res) => {
  const {
    roomId: reqRoomId,
    start_iso,
    duration_minutes,
    tz: reqTz,
    candidate_name = 'AIRA Candidate',
    recruiter_name = 'AIRA Recruiter',
    bot_name = 'AIRA Bot',
    observer_name='AIRA Sentinel',
    roles = ['candidate', 'recruiter', 'bot','Sentinel'],
    title = 'AIRA Interview',
    location = '',
    metadata = {}
  } = req.body || {};

  // validate time
  // const startMs = Date.parse(start_iso || '');
  // if (!Number.isFinite(startMs)) {
  //   return res.status(400).json({ error: 'invalid start_iso (must be ISO 8601, e.g. 2025-09-20T14:30:00Z)' });
  // }
  // validate time
const raw = (start_iso || '').trim();
if (!raw) {
  return res.status(400).json({ error: 'missing start_iso' });
}

// does string include explicit zone info? (Z or +hh:mm or -hh:mm)
const hasExplicitOffset = /[zZ]|[+\-]\d{2}:\d{2}$/.test(raw);

let startMs;
if (hasExplicitOffset) {
  // Respect the provided offset/Z
  const dt = DateTime.fromISO(raw, { setZone: true });
  if (!dt.isValid) return res.status(400).json({ error: 'invalid start_iso' });
  startMs = dt.toMillis();
} else {
  // No offset → interpret as local wall time in tz (if provided)
  if (reqTz && SUPPORTED_TZ.has(reqTz)) {
    const dt = DateTime.fromISO(raw, { zone: reqTz });
    if (!dt.isValid) return res.status(400).json({ error: 'invalid start_iso' });
    startMs = dt.toMillis();
  } else {
    // Fallback: treat naive string as UTC
    const dt = DateTime.fromISO(raw, { zone: 'utc' });
    if (!dt.isValid) return res.status(400).json({ error: 'invalid start_iso' });
    startMs = dt.toMillis();
  }
}
  const durMin = Number.isFinite(+duration_minutes) && +duration_minutes > 0 ? +duration_minutes : null;
  if (!durMin) {
    return res.status(400).json({ error: 'invalid duration_minutes (positive integer minutes required)' });
  }

  const tzid = (typeof reqTz === 'string' && SUPPORTED_TZ.has(reqTz)) ? reqTz : null;

  const roomId = (reqRoomId && String(reqRoomId).trim()) || genId('aira');
  const startEpochSec = Math.floor(startMs / 1000);
  const endMs = startMs + durMin * 60 * 1000; 

  const out = {
    roomId,
    start_iso: new Date(startMs).toISOString(),
    duration_minutes: durMin,
    timezone: tzid || 'UTC',
    display: displayBundle(startMs, endMs),   // readable strings for UTC/Eastern/India
    iceServers: ICE_SERVERS,
    metadata,
    roles: {}
  };

  // candidate
  if (roles.includes('candidate')) {
    const { token } = signTokenAt({ roomId, role: 'candidate', name: candidate_name, startEpochSec, durationMin: durMin });
    const joinUrl = buildJoinUrl(token, roomId, candidate_name, 'candidate');
    const ics = buildICS({
      uid: `${roomId}-candidate@aira`,
      title: `${title} — Candidate`,
      description: `Candidate: ${candidate_name}`,
      url: joinUrl,
      startMs, endMs, location,
      tzid
    });
    out.roles.candidate = { name: candidate_name, token, joinUrl, ics };
  }

  // recruiter
  if (roles.includes('recruiter')) {
    const { token } = signTokenAt({ roomId, role: 'recruiter', name: recruiter_name, startEpochSec, durationMin: durMin });
    const joinUrl = buildJoinUrl(token, roomId, recruiter_name, 'recruiter');
    const ics = buildICS({
      uid: `${roomId}-recruiter@aira`,
      title: `${title} — Recruiter`,
      description: `Recruiter: ${recruiter_name}`,
      url: joinUrl,
      startMs, endMs, location,
      tzid
    });
    out.roles.recruiter = { name: recruiter_name, token, joinUrl, ics };
  }

  // bot
  if (roles.includes('bot')) {
    const { token } = signTokenAt({ roomId, role: 'bot', name: bot_name, startEpochSec, durationMin: durMin });
    const joinUrl = buildJoinUrl(token, roomId, bot_name, 'bot');
    const ics = buildICS({
      uid: `${roomId}-bot@aira`,
      title: `${title} — Bot`,
      description: `Bot: ${bot_name}`,
      url: joinUrl,
      startMs, endMs, location,
      tzid
    });
    out.roles.bot = { name: bot_name, token, joinUrl, ics };
  }
  // Sentinel
  if (roles.includes('Sentinel')) {
    const { token } = signTokenAt({ roomId, role: 'Sentinel', name: observer_name, startEpochSec, durationMin: durMin });
    const joinUrl = buildJoinUrl(token, roomId, observer_name, 'Sentinel');
    const ics = buildICS({
      uid: `${roomId}-Sentinel@aira`,
      title: `${title} — Sentinel`,
      description: `Sentinel: ${observer_name}`,
      url: joinUrl,
      startMs, endMs, location,
      tzid
    });
    out.roles.Sentinel = { name: observer_name, token, joinUrl, ics };
  }


  return res.status(201).json(out);
});

module.exports = router;
