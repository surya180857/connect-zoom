import React, { useEffect, useRef, useState, useMemo } from "react";
import { io } from "socket.io-client";
// import { startSttStreaming } from "./sttClient";           // mic -> relay -> Deepgram (candidate only)
import { startAiraAudioPlayer } from "./airaAudioPlayer";  // TTS player (pulls PCM from relay)
// Internet signal strength only (no WebRTC qualityStats)

// Debug logging helpers for network signal
const DEBUG_NET = (() => {
  try {
    if (typeof window !== 'undefined' && typeof window.__debugNet === 'boolean') return !!window.__debugNet;
    const v = localStorage.getItem('__debug_net');
    return v === '1';
  } catch { return false; }
})();
function dlog(...args) { try { if (DEBUG_NET) console.log('[net]', ...args); } catch { } }

const params = new URLSearchParams(window.location.search);
const urlToken = params.get("t") || "";
const urlRoom = params.get("room") || "demo-room";
const urlName = params.get("name") || "AIRA Candidate";
const urlRole = params.get("role") || "candidate";
const urlDurMin = Number(params.get("dur") || params.get("minutes") || params.get("duration") || 1);
// Default danger window: last 2 minutes; override via ?danger_sec=...
const urlDangerSec = Number(params.get("danger_sec") || 120);
// Client-side late-join guard (minutes after scheduled start); server enforces too.
const urlLateJoinAfterMin = Number(params.get("late_min") || 10);
const urlAutoJoin = params.get("auto") === "";
// Reminder visibility duration in ms (default 3s); override via ?reminder_ms=...
const urlReminderMs = Number(params.get("reminder_ms") || 5000);

function parseJwtPayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64).split("").map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(json);
  } catch { return null; }
}

const payload = parseJwtPayload(urlToken);
const seededRole = String((payload?.role || urlRole) || "").toLowerCase();
const seededRoomId = payload?.roomId || urlRoom;
const seededName = payload?.name || (localStorage.getItem("displayName") || urlName);
const seededLocked = !!payload;
const seededConsent = seededRole === "candidate" ? false : true;

export default function App() {
  // Default to false so the client is lenient by default; server enforces the true policy.
  const [restrictLateJoin, setRestrictLateJoin] = useState(false);
  const [token, setToken] = useState(urlToken);
  const [roomId, setRoomId] = useState(seededRoomId);
  const [name, setName] = useState(seededName);
  const [role, setRole] = useState(seededRole);
  const [locked, setLocked] = useState(seededLocked);

  const [joined, setJoined] = useState(false);

  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);

  const [joining, setJoining] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine !== false : true);
  const [consent, setConsent] = useState(seededConsent);
  const [joinError, setJoinError] = useState(null);
  const [kickedOpen, setKickedOpen] = useState(false);
  const [kickedReason, setKickedReason] = useState("");
  const [showEndedDialog, setShowEndedDialog] = useState(false);
  const [endedDialogText, setEndedDialogText] = useState("This meeting has already ended.");
  // Disconnection/offline modal
  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [reconnectMessage, setReconnectMessage] = useState("You've been disconnected. Please rejoin.");


  const [startMs, setStartMs] = useState(0);
  const [tick, setTick] = useState(0);
  // One-time 5-minute remaining reminder
  const [fiveMinReminderShown, setFiveMinReminderShown] = useState(false);
  const [showFiveMinReminder, setShowFiveMinReminder] = useState(false);
  const [fiveMinHiding, setFiveMinHiding] = useState(false);

  // Waiting for bot popup state
  const [showWaitingForBot, setShowWaitingForBot] = useState(false);

  const [roomState, setRoomState] = useState({ participants: [] });
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // always-fresh copy for DOM/event callbacks
  const roomStateRef = useRef({ participants: [] });
  useEffect(() => { roomStateRef.current = roomState; }, [roomState]);



  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  // BOT-only: outbound TTS track we’ll publish to all peers
  const ttsTrackRef = useRef(null);

  // signaling
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());
  const remoteEls = useRef(new Map());
  const iceServersRef = useRef(null);
  // Internet quality (RTT to server)
  const netStatsRef = useRef(new Map()); // id -> { rttMs, level, ts }
  const selfNetRef = useRef(null);       // { rttMs, level, ts }
  const netTimerRef = useRef(null);
  // track whether timer came from server or is local fallback
  const timerSourceRef = useRef("none"); // 'server' | 'local' | 'none'

  // UI state
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);

  // STT handle (candidate only)
  // const sttRef = useRef(null);
  const [showConsentDialog, setShowConsentDialog] = useState(false);

  useEffect(() => { injectStyles(); }, []);

  // Track browser online/offline to guide Join UX
  useEffect(() => {
    function onOffline() { dlog('join screen: offline event'); setIsOnline(false); }
    function onOnline() { dlog('join screen: online event'); setIsOnline(true); }
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 2000, ...rest } = options;
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeout);
    try {
      const resp = await fetch(resource, { ...rest, signal: ctrl.signal, cache: 'no-store' });
      return resp;
    } finally { clearTimeout(id); }
  }

  // Quick pre-join connectivity check: browser online + server reachable
  async function checkConnectivity() {
    dlog('pre-join check: navigator.onLine =', typeof navigator !== 'undefined' ? navigator.onLine : 'unknown');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setJoinError({ reason: 'offline', message: 'No internet connection. Please check your connection and try again.' });
      dlog('pre-join check: offline, aborting join');
      return false;
    }
    try {
      const resp = await fetchWithTimeout('/healthz', { timeout: 2000, credentials: 'include' });
      dlog('pre-join check: /healthz status =', resp?.status);
      if (!resp || !resp.ok) {
        setJoinError({ reason: 'network', message: 'Unable to reach server. Please check your internet and try again.' });
        dlog('pre-join check: server unreachable');
        return false;
      }
      dlog('pre-join check: OK');
      return true;
    } catch {
      setJoinError({ reason: 'network', message: 'No internet connectivity detected. Please check your network and try again.' });
      dlog('pre-join check: exception during /healthz, treating as offline');
      return false;
    }
  }

  // Show a modal when the browser goes offline while in a call
  useEffect(() => {
    function onOffline() {
      if (joined) {
        dlog('in-call: offline event');
        setReconnectMessage("You’re offline. Please check your connection and rejoin.");
        setShowReconnectModal(true);
        // Mark internet as offline for self and update badge immediately
        try {
          selfNetRef.current = { rttMs: undefined, level: 'offline', ts: Date.now() };
          updateSelfQualityBadge();
        } catch { }
      }
    }
    function onOnline() {
      // Keep the modal until user chooses to rejoin to prevent surprising state changes
      // Clear offline self marker; next ping will refresh
      try { dlog('in-call: online event'); selfNetRef.current = null; updateSelfQualityBadge(); } catch { }
    }
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [joined]);

  // Fetch server-side policy to align client guard with server
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/policy-open', { credentials: 'include' });
        if (r.ok) {
          const p = await r.json();
          if (typeof p?.RESTRICT_LATE_JOIN === 'boolean') setRestrictLateJoin(p.RESTRICT_LATE_JOIN);
        }
      } catch { /* ignore; default true keeps prior behavior */ }
    })();
  }, []);

  useEffect(() => {
    if (!token) return;
    const p = parseJwtPayload(token);
    if (!p) return;
    if (p.roomId) setRoomId(String(p.roomId));
    if (p.role) setRole(String(p.role).toLowerCase());
    if (p.name) setName(String(p.name));
    setConsent(String(p.role).toLowerCase() !== "candidate");
    setLocked(true);
  }, [token]);

  useEffect(() => {
    const payload = parseJwtPayload(token);
    const exp = payload?.exp * 1000; // Convert expiration to milliseconds
    if (!exp) return;

    const currentTime = Date.now();
    const timeRemaining = exp - currentTime;

    // Trigger 5-minute reminder if the remaining time is less than or equal to 5 minutes (300000 ms)
    if (timeRemaining <= 5 * 60 * 1000 && timeRemaining > 0 && !fiveMinReminderShown) {
      setFiveMinReminderShown(true);
      setShowFiveMinReminder(true);
    }
  }, [token, fiveMinReminderShown]); // Runs whenever the token changes

  // Current token payload and any scheduled info embedded in it
  const tokenPayload = useMemo(() => parseJwtPayload(token), [token]);
  const scheduledStartMs = useMemo(() => {
    const nbf = tokenPayload?.nbf ? Number(tokenPayload.nbf) : null;
    return nbf ? nbf * 1000 : null;
  }, [tokenPayload]);
  const scheduledDurMin = useMemo(() => {
    // Prefer explicit duration (minutes) if present in token (set by scheduling API)
    const d = tokenPayload?.dur ?? tokenPayload?.durationMin;
    if (Number.isFinite(+d) && +d > 0) return +d;
    // Fallback: if nothing provided, return null so URL/default is used
    return null;
  }, [tokenPayload]);
  const scheduledGraceMin = useMemo(() => {
    // Grace minutes may be in token as `grace` (preferred)
    const g = tokenPayload?.grace ?? tokenPayload?.graceMin ?? tokenPayload?.grace_minutes;
    if (Number.isFinite(+g) && +g >= 0) return +g;
    return null;
  }, [tokenPayload]);

  

  useEffect(() => {
    if (!locked) return;
    const r = String(role || "").toLowerCase();
    if ((r === "bot" || urlAutoJoin || r === 'sentinel') && !joined && !joining) { join().catch(() => { }); }
  }, [locked, role, joined, joining]);

  useEffect(() => { refreshOverlays(); }, [roomState]);
  // Sync meeting timer start from server (snapshot includes startMs)
  useEffect(() => {
    if (roomState.startMs) {
      setStartMs(roomState.startMs);
      setBotJoinMs(roomState.startMs); // Also sync botJoinMs
      timerSourceRef.current = "server";
    } else {
      // Server indicates no timer; clear any local timer
      setStartMs(0);
      setBotJoinMs(null);
      if (timerSourceRef.current !== "server") timerSourceRef.current = "none";
    }
  }, [roomState.startMs]);



  useEffect(() => {
    if (!joined) return;
    const s = localStreamRef.current, v = localVideoRef.current;
    if (s && v && v.srcObject !== s) { v.srcObject = s; v.muted = true; v.playsInline = true; safePlay(v); }
  }, [joined]);

  // Keep local preview correct across browsers (especially Safari) when video toggles
  useEffect(() => {
    try { refreshSelfPreviewFor(!!videoOff); } catch { }
  }, [joined, videoOff]);

  const hasInterviewer = useMemo(
    () => roomState.participants.some(p => (p.role || "").toLowerCase() === "interviewer"),
    [roomState]
  );

  const botPresent = useMemo(
    () => roomState.participants.some(p => (p.role || "").toLowerCase() === "bot"),
    [roomState]
  );

  useEffect(() => {
    // Whenever participants update (name/role/mute/video), refresh labels on all remote tiles
    remoteEls.current.forEach((_el, id) => {
      const ov = document.getElementById("ov-" + id);
      if (ov) ov.textContent = labelForPeer(id);
    });
  }, [roomState]);

  useEffect(() => {
    if (!startMs) return; // If startMs is not set, do nothing

    // Update tick every second
    const interval = setInterval(() => {
      setStartMs(prevStart => prevStart);  // Keep updating startMs to keep the timer going
    }, 1000);

    return () => clearInterval(interval);  // Clean up interval when component unmounts
  }, [startMs]);


  useEffect(() => {
    if (!startMs) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [startMs]);

  // While waiting for scheduled start, tick UI so "Starts at" updates and flips at the right time
  useEffect(() => {
    if (!scheduledStartMs || startMs) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [scheduledStartMs, startMs]);

  // Trigger showing the 5-minute reminder once when crossing threshold
  useEffect(() => {
    const durMin = Number.isFinite(+scheduledDurMin) ? +scheduledDurMin : urlDurMin;
    const totalSec = Math.max(0, Math.floor(durMin * 60));
    if (!totalSec) return;

    const baseStart = scheduledStartMs || startMs || 0;
    const hasStarted = baseStart > 0 && Date.now() >= baseStart;
    if (!hasStarted) return;

    const elapsedSec = Math.max(0, Math.floor((Date.now() - baseStart) / 1000));
    const left = Math.max(0, totalSec - elapsedSec);

    if (!fiveMinReminderShown && totalSec > 300 && left <= 300 && elapsedSec < totalSec) {
      setFiveMinReminderShown(true);
      setShowFiveMinReminder(true);
    }
  }, [tick, startMs, scheduledStartMs, scheduledDurMin, urlDurMin, fiveMinReminderShown]);

  // // Handle auto-hide timing independent from ticking timer updates
  // useEffect(() => {
  //   if (!showFiveMinReminder) return;
  //   setFiveMinHiding(false);
  //   const fadeMs = Math.max(300, urlReminderMs - 400);
  //   const t1 = setTimeout(() => setFiveMinHiding(true), fadeMs);
  //   const t2 = setTimeout(() => { setShowFiveMinReminder(false); setFiveMinHiding(false); }, urlReminderMs);
  //   return () => { clearTimeout(t1); clearTimeout(t2); };
  // }, [showFiveMinReminder, urlReminderMs]);

  async function ensureLocalMedia() {
    if (localStreamRef.current) return localStreamRef.current;
    const r = String(role || "").toLowerCase();
    if (r === "bot" || r === 'sentinel') return null; // bot has no cam/mic
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: true
      });
      localStreamRef.current = s;
      setMuted(!s.getAudioTracks().some(t => t.enabled));
      setVideoOff(!s.getVideoTracks().some(t => t.enabled));
      //  Add speaking detection for yourself
      detectSpeaking(s, (isSpeaking) => {
        const selfTile = document.getElementById("wrap-self");
        if (selfTile) {
          selfTile.classList.toggle("speaking", isSpeaking);
        }
      });
      return s;
    } catch (e) {
      console.warn("[media] getUserMedia failed:", e);
      return null;
    }
  }
  function addLocalTracks(pc) {
    const s = localStreamRef.current; if (!s) return;
    s.getTracks().forEach(t => { try { pc.addTrack(t, s); } catch { } });
  }

  async function loadIceServers() {
    if (iceServersRef.current) return iceServersRef.current;
    const r = await fetch("/turn-credentials", { credentials: "include" });
    if (!r.ok) throw new Error("turn creds failed");
    const d = await r.json();
    iceServersRef.current = d.iceServers;
    setTimeout(() => { iceServersRef.current = null; }, Math.max(5, (d.ttl - 30)) * 1000);
    return iceServersRef.current;
  }

  async function forceRenegotiate(pc, remoteId) {
    try {
      if (pc.signalingState !== "stable") return;
      const off = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(off);
      socketRef.current?.emit("webrtc:offer", { to: remoteId, sdp: off });
    } catch (e) {
      console.warn("[negotiation] failed", e);
    }
  }

  function buildPeer(remoteId) {
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current || [{ urls: "stun:stun.l.google.com:19302" }] });
    addLocalTracks(pc);

    // If we're the BOT and we already have a TTS track, attach it to this new peer
    if (ttsTrackRef.current && String(role).toLowerCase() === "bot") {
      try { pc.addTrack(ttsTrackRef.current, new MediaStream([ttsTrackRef.current])); } catch { }
    }

    pc.onnegotiationneeded = debounce(async () => {
      try {
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(offer);
        socketRef.current.emit("webrtc:offer", { to: remoteId, sdp: offer });
      } catch { }
    }, 150);

    pc.onicecandidate = (e) => { if (e.candidate) socketRef.current.emit("webrtc:ice", { to: remoteId, ice: e.candidate }); };

    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0] || new MediaStream([ev.track]);
      attachRemote(remoteId, stream);
    };

    peersRef.current.set(remoteId, { pc });
    return pc;
  }

  async function makeOffer(remoteId) {
    const pc = peersRef.current.get(remoteId)?.pc || buildPeer(remoteId);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    socketRef.current.emit("webrtc:offer", { to: remoteId, sdp: offer });
  }

  function labelForPeer(id) {
    const list = roomStateRef.current?.participants || [];
    const p = list.find(x => x.id === id);
    if (!p) return `Peer ${id.slice(0, 6)}`;
    const n = (p.name && p.name.trim()) ? p.name.trim() : id.slice(0, 6);
    const r = (p.role && p.role.trim()) ? p.role.trim() : "";
    return r ? `${n} · ${r}` : n;
  }

  function refreshOverlays() {
    // Re-label every remote tile using the latest roomState
    remoteEls.current.forEach((_el, id) => {
      const ov = document.getElementById("ov-" + id);
      if (ov) ov.textContent = labelForPeer(id);

      updateRemoteIcons(id);
    });
  }
  useEffect(() => {
    refreshOverlays();
  }, [roomState]);

  useEffect(() => {
    const grid = document.getElementById('video-grid');
    if (!grid) return;

    // Run once on mount
    updateGridLayout();

    // Re-run on window resize
    const onResize = debounce(() => updateGridLayout(), 100);
    window.addEventListener('resize', onResize);

    // Watch tile additions/removals just in case (belt + suspenders)
    const mo = new MutationObserver(() => updateGridLayout());
    mo.observe(grid, { childList: true });

    return () => {
      window.removeEventListener('resize', onResize);
      mo.disconnect();
    };
  }, []);


  function attachRemote(id, stream) {
    const hasVideo = !!stream?.getVideoTracks?.().length;
    const elType = hasVideo ? "video" : "audio";
    let el = remoteEls.current.get(id);
    if (!el || el.nodeName.toLowerCase() !== elType) {
      el?.parentElement?.remove();
      el = document.createElement(elType);
      el.id = (hasVideo ? "vid-" : "aud-") + id;
      el.playsInline = true; el.autoplay = true; if (!hasVideo) el.muted = false;
      const tile = makeTile(id, el);
      document.getElementById("video-grid")?.appendChild(tile);
      remoteEls.current.set(id, el);
    }
    if (el.srcObject !== stream) el.srcObject = stream;
    // (new) keep overlay in sync with latest roomState
    const ov = document.getElementById("ov-" + id);
    if (ov) ov.textContent = labelForPeer(id);
    safePlay(el);
    //  Add speaking detection for audio
    detectSpeaking(stream, (isSpeaking) => {
      const tile = document.getElementById("wrap-" + id);
      if (tile) {
        if (isSpeaking) {
          tile.classList.add("speaking");
        } else {
          tile.classList.remove("speaking");
        }
      }
    });
    updateGridLayout();
  }

  function makeTile(id, mediaEl) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.id = "wrap-" + id;

    const list = roomStateRef.current?.participants || [];
    const p = list.find(x => x.id === id);
    if ((p?.role || "").toLowerCase() === "bot") {
      tile.classList.add("bot");
    }

    mediaEl.controls = false;
    tile.appendChild(mediaEl);

    // --- ADD ICON OVERLAYS ---
    const iconOverlay = document.createElement("div");
    iconOverlay.className = "remote-icons";
    iconOverlay.id = "icons-" + id;
    tile.appendChild(iconOverlay);

    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.id = "ov-" + id;                // stable overlay id per peer
    ov.textContent = labelForPeer(id); // initial label
    tile.appendChild(ov);

    // Connection quality badge (top-right): show candidate's signal to recruiters only
    try {
      const viewerRole = String(role || '').toLowerCase();
      const list2 = roomStateRef.current?.participants || [];
      const peer = list2.find(x => x.id === id);
      const peerRole = String(peer?.role || '').toLowerCase();
      if (viewerRole === 'recruiter' && peerRole === 'candidate') {
        const qb = document.createElement('div');
        qb.id = 'q-' + id;
        qb.className = 'quality-badge quality-unknown';
        const qIcon = document.createElement('span');
        qIcon.className = 'q-icon';
        qIcon.innerHTML = getQualityIconSvg('wifi', 1);
        const qLabel = document.createElement('span');
        qLabel.className = 'q-label';
        qLabel.textContent = 'Unknown';
        qb.appendChild(qIcon);
        qb.appendChild(qLabel);
        qb.title = 'Connection: unknown';
        tile.appendChild(qb);
      }
    } catch { }

    const fsBtn = document.createElement("button");
    fsBtn.className = "fullscreen-btn";
    fsBtn.textContent = "⛶"; // Unicode fullscreen icon

    fsBtn.onclick = () => {
      if (document.fullscreenElement === tile ||
        document.webkitFullscreenElement === tile ||
        document.msFullscreenElement === tile) {
        // Already fullscreen → exit
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) {
          document.msExitFullscreen();
        }
      } else {
        // Not fullscreen → enter
        if (tile.requestFullscreen) {
          tile.requestFullscreen();
        } else if (tile.webkitRequestFullscreen) { // Safari
          tile.webkitRequestFullscreen();
        } else if (tile.msRequestFullscreen) { // IE/Edge
          tile.msRequestFullscreen();
        }
      }
    };

    tile.appendChild(fsBtn);

    updateRemoteIcons(id);
    // Initialize internet signal badge (if present for this tile)
    try { updateQualityBadge(id); } catch { }
    return tile;
  }

  // No peer-based strength; see `strengthFromLevel` for internet RTT → bars

  function getQualityIconSvg(mode, strength = 1) {
    const s = Math.max(0, Math.min(3, Number(strength) || 0));
    // Wi‑Fi arcs
    const o1 = s >= 1 ? 1 : 0.25;
    const o2 = s >= 2 ? 1 : 0.25;
    const o3 = s >= 3 ? 1 : 0.25;
    return `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M2.5 8.5A15 15 0 0 1 21.5 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="${o3}"/>
        <path d="M5 12a11 11 0 0 1 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="${o2}"/>
        <path d="M8.5 15a7 7 0 0 1 7 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-opacity="${o1}"/>
        <circle cx="12" cy="18.5" r="1.8" fill="currentColor" fill-opacity="${o1}"/>
      </svg>`;
  }

  function updateQualityBadge(id) {
    const el = document.getElementById('q-' + id);
    if (!el) return;
    // Prefer internet signal if available for this peer (their RTT to server)
    const net = netStatsRef.current.get(id);
    const fresh = net && typeof net.ts === 'number' ? (Date.now() - net.ts) <= 6000 : false; // 6s freshness window
    let level = fresh && typeof net?.rttMs === 'number' ? (net.level || levelFromRtt(net.rttMs)) : 'unknown';
    let status = fresh && typeof net?.rttMs === 'number' ? 'online' : 'offline';
    dlog('updateQualityBadge', { id, rtt: net?.rttMs, level, fresh, status });
    // Map colors: good(green), ok(amber), poor(red), disconnected(gray)
    const colorLevel =
      status === 'offline' ? 'disconnected' :
        status === 'reconnecting' ? 'ok' :
          status === 'online' ? (level === 'good' ? 'good' : level === 'ok' ? 'ok' : level === 'poor' ? 'poor' : 'unknown') :
            'unknown';
    el.classList.remove('quality-good', 'quality-ok', 'quality-poor', 'quality-unknown', 'quality-disconnected');
    el.classList.add('quality-' + colorLevel);
    const m = fresh && typeof net?.rttMs === 'number' ? { rttMs: net.rttMs } : {};
    const pct = (v) => (typeof v === 'number' ? Math.round(v * 100) : undefined);
    const parts = [];
    if (typeof m.rttMs === 'number') parts.push(`RTT ${m.rttMs}ms`);
    // no peer metrics here (internet-only)
    // Map to requested wording:
    // - Strong for good
    // - Weak for ok or reconnecting (disconnecting)
    // - Poor for poor
    // - Disconnected for offline
    let displayLabel = 'Unknown';
    if (status === 'offline') displayLabel = 'Disconnected';
    else if (status === 'reconnecting') displayLabel = 'Weak';
    else if (level === 'good') displayLabel = 'Strong';
    else if (level === 'ok') displayLabel = 'Weak';
    else if (level === 'poor') displayLabel = 'Poor';
    el.title = `Network: ${displayLabel}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
    // icon
    try {
      const iconEl = el.querySelector('.q-icon');
      if (iconEl) iconEl.innerHTML = getQualityIconSvg('wifi', strengthFromLevel(level));
    } catch { }
    // label
    const labelEl = el.querySelector('.q-label');
    if (labelEl) labelEl.textContent = displayLabel;

    // Also update compact badge in Participants list
    try {
      const listEl = document.getElementById('qlist-' + id);
      if (listEl) {
        listEl.classList.remove('quality-good', 'quality-ok', 'quality-poor', 'quality-unknown', 'quality-disconnected');
        listEl.classList.add('quality-' + colorLevel);
        listEl.title = `Connection: ${displayLabel}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
        const iconEl2 = listEl.querySelector('.q-icon');
        if (iconEl2) iconEl2.innerHTML = getQualityIconSvg('wifi', strengthFromLevel(level));
      }
    } catch { }
  }

  // Update the self badge preferring internet RTT; fallback to worst peer quality
  function updateSelfQualityBadge() {
    const el = document.getElementById('q-self');
    if (!el) return;
    // If browser reports offline, show Disconnected immediately
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      dlog('self badge: navigator offline');
      el.classList.remove('quality-good', 'quality-ok', 'quality-poor', 'quality-unknown', 'quality-disconnected');
      el.classList.add('quality-disconnected');
      const iconEl = el.querySelector('.q-icon'); if (iconEl) iconEl.innerHTML = getQualityIconSvg('wifi', 0);
      const labelEl = el.querySelector('.q-label'); if (labelEl) labelEl.textContent = 'Disconnected';
      el.title = 'Network: Disconnected';
      return;
    }
    // If we have a recent internet RTT, use it
    const net = selfNetRef.current;
    const fresh = net && typeof net.ts === 'number' ? (Date.now() - net.ts) <= 6000 : false;
    if (fresh && typeof net.rttMs === 'number') {
      const level = net.level || levelFromRtt(net.rttMs);
      dlog('self badge: using RTT', net.rttMs, 'level', level);
      const status = 'online';
      const colorLevel = level === 'good' ? 'good' : level === 'ok' ? 'ok' : level === 'poor' ? 'poor' : 'unknown';
      el.classList.remove('quality-good', 'quality-ok', 'quality-poor', 'quality-unknown', 'quality-disconnected');
      el.classList.add('quality-' + colorLevel);
      const displayLabel = level === 'good' ? 'Strong' : level === 'ok' ? 'Weak' : level === 'poor' ? 'Poor' : 'Unknown';
      const parts = [`RTT ${net.rttMs}ms`];
      el.title = `Network: ${displayLabel} · ${parts.join(' · ')}`;
      const iconEl = el.querySelector('.q-icon'); if (iconEl) iconEl.innerHTML = getQualityIconSvg('wifi', strengthFromLevel(level));
      const labelEl = el.querySelector('.q-label'); if (labelEl) labelEl.textContent = displayLabel;
      return;
    }

    // If we recently marked offline, reflect that status
    if (net && net.level === 'offline') {
      dlog('self badge: marked offline due to stale pongs');
      el.classList.remove('quality-good', 'quality-ok', 'quality-poor', 'quality-unknown', 'quality-disconnected');
      el.classList.add('quality-disconnected');
      const iconEl = el.querySelector('.q-icon'); if (iconEl) iconEl.innerHTML = getQualityIconSvg('wifi', 0);
      const labelEl = el.querySelector('.q-label'); if (labelEl) labelEl.textContent = 'Disconnected';
      el.title = 'Network: Disconnected';
      return;
    }

    // Else unknown
    dlog('self badge: unknown (no RTT yet)');
    el.classList.remove('quality-good', 'quality-ok', 'quality-poor', 'quality-unknown', 'quality-disconnected');
    el.classList.add('quality-unknown');
    const iconEl = el.querySelector('.q-icon'); if (iconEl) iconEl.innerHTML = getQualityIconSvg('wifi', 1);
    const labelEl = el.querySelector('.q-label'); if (labelEl) labelEl.textContent = 'Unknown';
    el.title = 'Connection: unknown';
  }

  // Removed peer-based quality monitor: we show internet signal only

  function updateRemoteIcons(id) {
    const container = document.getElementById("icons-" + id);
    if (!container) return;

    const list = roomStateRef.current?.participants || [];
    const p = list.find(x => x.id === id);
    if (!p) return;

    container.innerHTML = ''; // Clear existing icons

    // Add muted icon if muted
    if (p.muted) {
      const micIcon = document.createElement("div");
      micIcon.className = "remote-icon-badge";
      micIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 3a3 3 0 0 1 3 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M19 10v1a7 7 0 0 1-7 7 7 7 0 0 1-7-7v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 21v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    `;
      container.appendChild(micIcon);
    }

    // Add video-off icon if video is off
    if (p.videoOff) {
      const videoIcon = document.createElement("div");
      videoIcon.className = "remote-icon-badge";
      videoIcon.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="13" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
        <path d="M16 9l5-3v12l-5-3V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    `;
      container.appendChild(videoIcon);
    }
  }


  function emitAv() {
    const s = localStreamRef.current; if (!s) {
      console.log("[emitAv] No local stream found");
      return;
    }
    const mutedNow = !s.getAudioTracks().some(t => t.enabled);
    const videoOffNow = !s.getVideoTracks().some(t => t.enabled);
    socketRef.current?.emit("presence:av", { muted: mutedNow, videoOff: videoOffNow });
  }

  function computeCols(n) {
    if (n <= 1) return 1;
    if (n === 2) return 2;
    if (n <= 4) return 2;   // 3–4 → 2 columns (Zoom-ish look)
    if (n <= 6) return 3;   // 5–6 → 3 columns
    if (n <= 9) return 3;   // 7–9 → 3×3
    if (n <= 12) return 4;  // 10–12 → 4 columns
    return Math.min(6, Math.ceil(Math.sqrt(n))); // fallback for big rooms
  }

  function updateGridLayout() {
    const grid = document.getElementById("video-grid");
    if (!grid) return;

    const tiles = grid.querySelectorAll(".tile");
    const n = tiles.length;

    const cols = computeCols(n);
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    // Reset all tiles
    tiles.forEach((t) => {
      t.style.gridColumn = "auto";
      t.style.gridRow = "auto";
      t.style.justifySelf = "";
      t.style.width = "";
    });

    // If the last row has only 1 tile → add class so CSS centers it
    const remainder = n % cols;
    if (n > 1 && remainder === 1 && cols > 1) {
      const last = tiles[tiles.length - 1];
      const cs = getComputedStyle(grid);
      const gap = parseFloat(cs.columnGap || cs.gap || "0");
      const gridW = grid.clientWidth; // content width (includes padding)
      const cellW = (gridW - (cols - 1) * gap) / cols; // exact width of a normal cell

      // put the last tile on its own row, center it, keep same width as others
      last.style.gridColumn = "1 / -1";
      last.style.justifySelf = "center";
      last.style.width = `${cellW}px`;
      grid.classList.add("center-last");
    } else {
      grid.classList.remove("center-last");
    }
  }

  // Combined: native confirmation + back button modal
  useEffect(() => {
    if (!joined) return;

    // 1. Native browser confirmation for refresh/close
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    // 2. Custom modal for back button
    window.history.pushState({ preventNav: true }, '');

    const handlePopState = (e) => {
      if (e.state?.preventNav) {
        setShowLeaveModal(true);
        window.history.pushState({ preventNav: true }, '');
      }
    };

    window.history.pushState({ preventNav: true }, '');

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [joined]);


  const [chat, setChat] = useState([]);
  const chatListRef = useRef(null);
  const [unread, setUnread] = useState(0);
  // Always navigate to the most recent message when chat updates
  useEffect(() => {
    const el = chatListRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnread(0);
  }, [chat]);
  function scrollChatToBottom() {
    const el = chatListRef.current; if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setUnread(0);
  }
  // Clear unread when user scrolls to bottom
  useEffect(() => {
    const el = chatListRef.current; if (!el) return;
    const onScroll = () => {
      const atBottom = (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 8);
      if (atBottom) setUnread(0);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const [botJoinMs, setBotJoinMs] = useState(null);

  // // In your roomState effect
  // useEffect(() => {
  //   const botPresent = roomState.participants?.some(
  //     (p) => String(p.role || "").toLowerCase() === "bot"
  //   );
  //   if (botPresent && !botJoinMs) {
  //     setBotJoinMs(Date.now()); // record first bot join
  //     setStartMs(Date.now());
  //   }
  // }, [roomState.participants, botJoinMs]);

  // Show "Waiting for AIRA" popup when joined but bot hasn't arrived yet
  useEffect(() => {
    if (!joined) return;

    const botPresent = roomState.participants?.some(
      p => String(p.role || "").toLowerCase() === "bot"
    );

    // Show popup if we're joined but bot isn't present
    setShowWaitingForBot(!botPresent);
  }, [joined, roomState.participants]);


  function sendChat(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    socketRef.current?.emit("chat:send", { roomId, message: trimmed });
    // Jump to the latest message immediately for the sender
    setTimeout(() => scrollChatToBottom(), 0);

  }

  // async function startSttIfCandidate() {
  //   if (String(role).toLowerCase() !== "candidate") return;
  //   if (!localStreamRef.current) return;
  //   try {
  //     const relayOrigin =
  //       window.RELAY_ORIGIN ||
  //       process.env.REACT_APP_RELAY_ORIGIN ||
  //       "https://connectdev.airahr.ai";
  //     sttRef.current = await startSttStreaming({
  //       localStream: localStreamRef.current,
  //       sessionId: roomId,
  //       relayOrigin
  //     });
  //     console.log("[STT] started via", relayOrigin);
  //   } catch (e) {
  //     console.warn("[STT] failed to start:", e?.message || e);
  //   }
  // }
  // function stopStt() {
  //   try { sttRef.current?.stop?.(); } catch { }
  //   sttRef.current = null;
  // }

  async function join() {
    if (joined || joining) return;
    // Preflight: ensure internet connectivity before proceeding
    const okNet = await checkConnectivity();
    if (!okNet) return;
    if (String(role).toLowerCase() === "candidate" && !consent) {
      setShowConsentDialog(true);
      return;
    }
    if (!token) { console.warn("[join] missing access token"); return; }

    // Show "meeting ended" only when Join is triggered
    try {
      const expSec = parseJwtPayload(token)?.exp ? Number(parseJwtPayload(token).exp) : null;
      if (expSec && Number.isFinite(expSec) && Date.now() > (expSec * 1000)) {
        const msg = 'This meeting has already ended.';
        setJoinError({ reason: 'too_late', message: msg });
        setEndedDialogText(msg);
        setShowEndedDialog(true);
        return;
      }
    } catch { }

    // Preflight: ask server if this room/token is already ended to avoid long "joining..."
    try {
      const resp = await fetch(`/api/validate?t=${encodeURIComponent(token)}`);
      if (resp.ok) {
        const v = await resp.json();
        if (v?.ended) {
          const msg = 'This meeting has already ended.';
          setJoinError({ reason: 'too_late', message: msg });
          setEndedDialogText(msg);
          setShowEndedDialog(true);
          return;
        }
      }
    } catch (_) { /* ignore network hiccups; socket path will handle */ }

    // No client-side late-join guard; server enforces policy.

    setJoining(true);
    setJoinError(null);
    try {
      await ensureLocalMedia();
      try { await loadIceServers(); } catch (e) { console.warn("[TURN] failed:", e?.message || e); }

      const socket = io({ transports: ["websocket", "polling"], auth: { t: token, token } });
      socketRef.current = socket;
      if (typeof window !== "undefined") window.__airaSocket = socketRef;   // debug

      socket.on("connect", () => { console.log("[socket] connected", socket.id); dlog('socket connected id=', socket.id); });
      socket.on("disconnect", (reason) => {
        try { console.warn("[socket] disconnected:", reason); } catch { }
        dlog('socket disconnect:', reason);
        if (joined) {
          const msg = !navigator.onLine
            ? "You’re offline. Please check your connection and rejoin."
            : (reason === 'io server disconnect' ? 'Disconnected from server. Rejoin to continue.' : 'Connection lost. Rejoin to continue.');
          setReconnectMessage(msg);
          setShowReconnectModal(true);
          // Mark internet as offline for self and update badge
          try { selfNetRef.current = { rttMs: undefined, level: 'offline', ts: Date.now() }; updateSelfQualityBadge(); } catch { }
        }
      });
      // Internet quality: server RTT ping/pong
      socket.on('net:pong', ({ t } = {}) => {
        if (typeof t !== 'number') return;
        const rtt = Math.max(0, Date.now() - t);
        const level = levelFromRtt(rtt);
        selfNetRef.current = { rttMs: rtt, level, ts: Date.now() };
        dlog('pong RTT(ms)=', rtt, 'level=', level);
        // Share with room so others (e.g., recruiters) can see our internet signal
        try {
          const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
          const down = typeof conn?.downlink === 'number' ? conn.downlink : undefined;
          const eff = conn?.effectiveType || undefined;
          socket.emit('net:self', { rttMs: rtt, level, downlink: down, effectiveType: eff });
        } catch { }
        try { updateSelfQualityBadge(); } catch { }
      });
      socket.on('net:peer', ({ id, rttMs, level } = {}) => {
        if (!id) return;
        const lvl = level || levelFromRtt(rttMs);
        netStatsRef.current.set(id, { rttMs, level: lvl, ts: Date.now() });
        dlog('peer RTT update:', id, 'rttMs=', rttMs, 'level=', lvl);
        // Prefer internet signal when available for badges
        try { updateQualityBadge(id); } catch { }
      });
      socket.on("disconnect", (reason) => {
        try { console.warn("[socket] disconnected:", reason); } catch { }
        if (joined) {
          const msg = !navigator.onLine
            ? "You’re offline. Please check your connection and rejoin."
            : (reason === 'io server disconnect' ? 'Disconnected from server. Rejoin to continue.' : 'Connection lost. Rejoin to continue.');
          setReconnectMessage(msg);
          setShowReconnectModal(true);
          // Mark internet as offline for self and update badge
          try { selfNetRef.current = { rttMs: undefined, level: 'offline', ts: Date.now() }; updateSelfQualityBadge(); } catch { }
        }
      });
      socket.on("connect", () => {
        // If socket has recovered, clear the banner; user can continue or proactively rejoin
        setShowReconnectModal(false);
      });
      socket.on("connect_error", (err) => {
        console.error("[socket] connect_error", err);
        setJoining(false);
        setJoinError({ reason: 'network', message: 'Unable to connect. Please try again.' });
      });

      // Sync timer immediately if server sends it (in addition to room:state)
      socket.on("room:timer", ({ startMs: s, now }) => {
        if (s) {
          setStartMs(s);
          setBotJoinMs(s);
          timerSourceRef.current = "server";
          console.log("[timer] synced from server:", s);
        }
      });

      // socket.on("room:state", snap => setRoomState(snap));
      socket.on("room:state", snap => {
        setRoomState(snap);
        setTimeout(refreshOverlays, 0);
      });
      // });

      socket.on("chat:recv", (msg) => {
        const ts = Number.isFinite(+msg?.ts) ? +msg.ts : Date.now();
        setChat(c => [...c, { ...msg, ts }]);
      });
      socket.on("chat:history", ({ messages }) => {
        try {
          const arr = Array.isArray(messages) ? messages : [];
          const normalized = arr.map(m => ({ ...m, ts: Number.isFinite(+m?.ts) ? +m.ts : Date.now() }));
          setChat(normalized);
          setUnread(0);
          setTimeout(() => { const el = chatListRef.current; if (el) el.scrollTo({ top: el.scrollHeight }); }, 0);
        } catch { }
      });

      socket.on("join-ok", async ({ roomId: rid, others, startMs }) => {
        console.log("[join] ok for room", rid, "others:", others, "startMs", startMs);
        setJoined(true);
        setJoinError(null);
        window.sessionId = rid;

        // ---- TTS audio player: always start; only BOT publishes
        try {
          const relayOrigin =
            window.RELAY_ORIGIN ||
            process.env.REACT_APP_RELAY_ORIGIN ||
            "https://connectdev.airahr.ai";

          await startAiraAudioPlayer({ sessionId: rid, relayOrigin, monitor: false });
          const isBot = String(role).toLowerCase() === "bot";
          console.log("[/audio] player started via", relayOrigin, "bot?", isBot);

          if (isBot) {
            const ttsTrack = window.__airaAudio?.dest?.stream?.getAudioTracks?.()[0];
            if (ttsTrack) {
              ttsTrackRef.current = ttsTrack;
              // attach to all existing peers + renegotiate
              peersRef.current.forEach(async ({ pc }, remoteId) => {
                try { pc.addTrack(ttsTrackRef.current, new MediaStream([ttsTrackRef.current])); } catch { }
                await forceRenegotiate(pc, remoteId);
              });
              console.log("[/audio] TTS track attached + renegotiated");
            } else {
              console.warn("[/audio] no TTS track found from player");
            }
          }
        } catch (e) {
          console.error("[/audio] player failed:", e);
        }

        // Candidate mic streaming
        // await startSttIfCandidate();

        for (const pid of others) await makeOffer(pid);
        emitAv();
        updateGridLayout();
        try {
          const r = String(role || '').toLowerCase();
          if (r === 'candidate' || r === 'recruiter') setTimeout(() => updateSelfQualityBadge(), 0);
        } catch { }
        // Start periodic internet pings (every 2s)
        try {
          if (netTimerRef.current) clearInterval(netTimerRef.current);
          netTimerRef.current = setInterval(() => {
            try { const t = Date.now(); dlog('send ping t=', t); socketRef.current?.emit('net:ping', { t }); } catch { }
            // If we haven't seen a pong recently, mark as offline and refresh badges
            try {
              const now = Date.now();
              const last = selfNetRef.current?.ts || 0;
              if (!last || (now - last) > 6000) {
                dlog('no recent pong, forcing self offline');
                selfNetRef.current = { rttMs: undefined, level: 'offline', ts: last };
                updateSelfQualityBadge();
              }
              // Refresh remote badges to reflect staleness
              netStatsRef.current.forEach((_v, peerId) => { try { updateQualityBadge(peerId); } catch { } });
            } catch { }
          }, 2000);
        } catch { }
      });

      socket.on('duplicate_candidate', () => {
        try { console.log('[client] duplicate_candidate for room', data?.roomId); } catch { }
        setJoining(false);
        setShowDuplicateDialog(true);
      });

      // Show a clear message when the server ends the meeting via API
      socket.on('meeting:ended', ({ reason } = {}) => {
        try { console.log('[client] meeting:ended', reason || '(no reason)'); } catch { }
        // Show modal immediately and leave the room right away
        setKickedReason('The meeting has ended for everyone.');
        setKickedOpen(true);
        leave();
      });

      socket.on("kicked", ({ reason }) => {
        if (reason === "meeting_over") {
          console.log("Meeting ended for everyone via api call: /meeting/:roomId/end");
          // Show modal immediately and leave without delay
          setKickedReason("The meeting has ended for everyone.");
          setKickedOpen(true);
          leave();
        }
        else {
          // console.log("[client] YOU were kicked out", reason);
          console.log("[client] Candidate has been removed from the meeting", reason);
          leave();  // go back to join screen
          setKickedReason(reason);
          setKickedOpen(true);
        }
      });

      socket.on("join-denied", (payload) => {
        console.warn("[join] denied", payload);
        setJoining(false);
        const reason = String(payload?.reason || "");
        if (reason === "consent_required") setShowConsentDialog(true);
        // Normalize messaging: for any 'too_late', prefer the generic 'meeting ended' copy
        let friendly = null;
        if (reason === 'too_late') {
          friendly = 'This meeting has already ended.';
        } else {
          friendly = payload?.message || (
            reason === "consent_required" ? "Please accept recording to join." :
              reason === "too_early" ? "You can only join 10 minutes before the scheduled meeting." :
                reason === "role_taken" ? "This role is already taken in the room." :
                  reason === "room_full" ? "The room is full right now." :
                    "Join was denied. Please try again or contact support."
          );
        }
        setJoinError({ reason, message: friendly });
        if (reason === 'too_late') {
          setEndedDialogText(friendly);
          setShowEndedDialog(true);
        }
      });

      socket.on("webrtc:offer", async ({ from, sdp }) => {
        const pc = peersRef.current.get(from)?.pc || buildPeer(from);
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const ans = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
        await pc.setLocalDescription(ans);
        socketRef.current.emit("webrtc:answer", { to: from, sdp: ans });
      });
      socket.on("webrtc:answer", async ({ from, sdp }) => {
        const pc = peersRef.current.get(from)?.pc; if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      });
      socket.on("webrtc:ice", async ({ from, ice }) => {
        const pc = peersRef.current.get(from)?.pc; if (!pc || !ice) return;
        try { await pc.addIceCandidate(ice); } catch { }
      });

      //  If Sentinel joins late, re-offer our stream to it

      socket.on("sentinel:joined", async ({ sentinelId }) => {

        console.log("[client] Sentinel joined — sending new offer to", sentinelId);

        try {

          // ensure we already have local media ready

          await ensureLocalMedia();

          // create a new peer connection to Sentinel

          const pc = new RTCPeerConnection({ iceServers: iceServersRef.current || [{ urls: "stun:stun.l.google.com:19302" }] });

          addLocalTracks(pc); // reuse your existing helper

          // handle ICE

          pc.onicecandidate = (ev) => {

            if (ev.candidate) socket.emit("webrtc:ice", { to: sentinelId, ice: ev.candidate });

          };

          // handle remote stream from Sentinel (though Sentinel usually doesn’t send)

          pc.ontrack = (ev) => {

            const stream = ev.streams?.[0] || new MediaStream([ev.track]);

            attachRemote(sentinelId, stream);

          };

          peersRef.current.set(sentinelId, { pc });

          // create and send offer

          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });

          await pc.setLocalDescription(offer);

          socket.emit("webrtc:offer", { to: sentinelId, sdp: offer });

          console.log("[client] Offer sent to Sentinel successfully");

        } catch (err) {

          console.error("[client] Failed to offer to Sentinel:", err);

        }

      });

      socket.on("presence", (e) => {
        if (e.type === "left") {
          const entry = peersRef.current.get(e.socketId);
          try { if (entry?.qualityTimer) clearInterval(entry.qualityTimer); } catch { }
          try { entry?.pc?.close(); } catch { }
          peersRef.current.delete(e.socketId);
          const el = remoteEls.current.get(e.socketId);
          el?.parentElement?.remove();
          remoteEls.current.delete(e.socketId);
          updateGridLayout();
          try { updateSelfQualityBadge(); } catch { }
        }
        if (e.type === "joined") {
          // we have name/role in the event — relabel immediately if the tile exists
          const ov = document.getElementById("ov-" + e.socketId);
          if (ov) {
            const name = (e.name && e.name.trim()) ? e.name.trim() : e.socketId.slice(0, 6);
            const role = (e.role && e.role.trim()) ? ` · ${e.role.trim()}` : "";
            ov.textContent = `${name}${role}`;
          }
        }
        setTimeout(refreshOverlays, 0);
        // Append a system message when a candidate joins — visible only to recruiters
        try {
          const evRole = String(e.role || '').toLowerCase();
          const viewerRole = String(role || '').toLowerCase();
          if (viewerRole === 'recruiter' && e.type === 'joined' && evRole === 'candidate') {
            const who = (e.name && e.name.trim()) ? e.name.trim() : (e.socketId ? e.socketId.slice(0, 6) : 'candidate');
            setChat(c => [...c, { system: true, message: `${who} joined`, ts: Date.now() }]);
          }
        } catch { }
      });

      // Also handle explicit name updates
      socket.on("presence:update", ({ id /*, name*/ }) => {
        // server also emits room:state, but relabel now for snappy UI
        const ov = document.getElementById("ov-" + id);
        if (ov) ov.textContent = labelForPeer(id);
        setTimeout(refreshOverlays, 0);
      });

      // expose for console debugging
      if (typeof window !== "undefined") window.__airaPeers = peersRef;

      socket.emit("join", { roomId, name, role, consent: role !== "candidate" ? true : !!consent, t: token });
      localStorage.setItem("displayName", name || "");
    } catch (e) {
      console.error("[join] fatal", e);
      setJoining(false);
    }
  }

  function confirmJoinHere() {
    console.log('[client] confirmJoinHere -> emit force_join', { roomId });
    socketRef.current?.emit('force_join', { roomId }); // server reads auth + pendingJoin
    setShowDuplicateDialog(false);
    setJoining(true);
  }
  function cancelDuplicateJoin() {
    console.log('[client] cancelDuplicateJoin');
    setShowDuplicateDialog(false);
    setJoining(false);
  }

  function toggleMic() {
    const s = localStreamRef.current; if (!s) return;
    s.getAudioTracks().forEach(t => t.enabled = !t.enabled);
    const enabled = s.getAudioTracks().some(t => t.enabled);
    setMuted(!enabled);
    emitAv();
  }
  function toggleCam() {
    const s = localStreamRef.current; if (!s) return;
    s.getVideoTracks().forEach(t => t.enabled = !t.enabled);
    const enabled = s.getVideoTracks().some(t => t.enabled);
    setVideoOff(!enabled);
    emitAv();
  }
  function leave() {
    try {
      stopStt();
      try { if (netTimerRef.current) clearInterval(netTimerRef.current); } catch { }
      socketRef.current?.emit("leave", { roomId });
      peersRef.current.forEach(({ pc, qualityTimer }) => { try { if (qualityTimer) clearInterval(qualityTimer); } catch { } try { pc.close(); } catch { } });
      peersRef.current.clear();
      remoteEls.current.forEach(el => el?.parentElement?.remove());
      remoteEls.current.clear();
      updateGridLayout();
    } finally {
      setShowReconnectModal(false);
      // reset all local state so UI goes back to Join screen automatically
      setJoined(false);
      setJoining(false);
      setStartMs(0);
      setRoomState({ participants: [] }); // clear participant list
      setChat([]);                        // clear chat history
    }
  }

  function handleRejoin() {
    // Leave cleanly and then attempt to rejoin
    try { setShowReconnectModal(false); } catch { }
    try { leave(); } catch { }
    setTimeout(() => { try { join(); } catch { } }, 100);
  }


  const { remainingText, danger, dangerSecText, inGrace, graceText } = useMemo(() => {
    const durMin = Number.isFinite(+scheduledDurMin) ? +scheduledDurMin : urlDurMin;
    const totalSec = Math.max(0, Math.floor(durMin * 60));
    // base start prefers scheduled nbf, then server/local startMs
    const baseStart = botJoinMs || startMs || 0;
    const hasStarted = baseStart > 0 && Date.now() >= baseStart;
    const elapsedSec = hasStarted ? Math.max(0, Math.floor((Date.now() - baseStart) / 1000)) : 0;
    const shownSec = Math.min(elapsedSec, totalSec);
    const h = Math.floor(shownSec / 3600);
    const m = Math.floor((shownSec % 3600) / 60);
    const s = shownSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const txt = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    const dangerWindowSec = Number.isFinite(+urlDangerSec) && +urlDangerSec > 0 ? +urlDangerSec : 120;
    const inDanger = hasStarted && (totalSec - elapsedSec) <= dangerWindowSec && elapsedSec < totalSec;
    const left = Math.max(0, totalSec - elapsedSec);
    // Countdown during danger window should reflect actual remaining time
    const rem = left;
    let dangerSecText = null;
    if (inDanger) {
      if (dangerWindowSec <= 60) {
        dangerSecText = `00:${pad(rem)}`;
      } else {
        const mm = Math.floor(rem / 60);
        const ss = rem % 60;
        dangerSecText = `${pad(mm)}:${pad(ss)}`;
      }
    }
    // Grace time (after scheduled duration)
    const rawOver = Math.max(0, elapsedSec - totalSec);
    const graceLimitSec = Number.isFinite(+scheduledGraceMin) ? Math.max(0, Math.floor(+scheduledGraceMin * 60)) : null;
    const over = graceLimitSec == null ? rawOver : Math.min(rawOver, graceLimitSec);
    const inGrace = hasStarted && elapsedSec >= totalSec;
    const gh = Math.floor(over / 3600);
    const gm = Math.floor((over % 3600) / 60);
    const gs = over % 60;
    const graceText = gh > 0 ? `${pad(gh)}:${pad(gm)}:${pad(gs)}` : `${pad(gm)}:${pad(gs)}`;
    return { remainingText: txt, danger: inDanger, dangerSecText, inGrace, graceText };
  }, [botJoinMs, startMs, scheduledDurMin, scheduledGraceMin, tick, urlDurMin, urlDangerSec]);

  const elapsedTime = Math.floor((Date.now() - startMs) / 1000); // Calculate elapsed time in seconds

  const displayTime = (elapsedTime) => {
    // const hours = String(Math.floor(elapsedTime / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((elapsedTime % 3600) / 60)).padStart(2, '0');
    const seconds = String(elapsedTime % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  // UseEffect for ticking the timer
  useEffect(() => {
    if (!startMs) return; // If startMs is not set, do nothing

    const interval = setInterval(() => {
      setTick((prevTick) => prevTick + 1);
    }, 1000);

    return () => clearInterval(interval); // Clean up on unmount
  }, [startMs]);


  if (!joined) {
    return (
      <div className="join">
        <div className="join-card">
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 26 }}>Join Interview</div>
          {joinError && (
            <div className="alert error" role="alert">{joinError.message}</div>
          )}

          <div className="row">
            <label>Room</label>
            <input className="inp" value={roomId} onChange={e => setRoomId(e.target.value)} disabled={locked || joining} />
          </div>
          <div className="row">
            <label>Name</label>
            <input className="inp" value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => localStorage.setItem('displayName', name)}
              disabled={joining || (locked && role !== "recruiter" && role !== "interviewer")}
            />
          </div>
          <div className="row">
            <label>Role</label>
            <select className="inp" value={role} onChange={e => setRole(e.target.value)} disabled={locked || joining}>
              <option value="candidate">candidate</option>
              <option value="interviewer">interviewer</option>
              <option value="recruiter">recruiter</option>
              <option value="observer">observer</option>
              <option value="bot">bot</option>
              <option value="sentinel">sentinel</option>
            </select>
          </div>
          {role === "candidate" && (
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                disabled={joining}
              /> I understand this interview will be recorded.
            </label>
          )}
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={join} disabled={joining || !isOnline} title={!isOnline ? 'You are offline' : 'Join the meeting'}>
              {joining ? "Joining…" : (!isOnline ? 'Offline' : 'Join')}
            </button>
          </div>
          {!isOnline && (
            <div className="alert error" role="alert">You appear to be offline. Please check your internet connection.</div>
          )}

          {showConsentDialog && (
            <div className="modal-backdrop">
              <div className="modal">
                <p>Please check the consent box to agree to recording before joining.</p>
                <button className="btn" onClick={() => setShowConsentDialog(false)}>OK</button>
              </div>
            </div>
          )}

          {showDuplicateDialog && (
            <div className="modal-backdrop">
              <div className="modal">
                <p>You already exist in the meeting. Join here instead?</p>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
                  <button className="btn" onClick={cancelDuplicateJoin}>Cancel</button>
                  <button className="btn primary" onClick={confirmJoinHere}>Join</button>
                </div>
              </div>
            </div>
          )}
          {showEndedDialog && (
            <div className="modal-backdrop">
              <div className="modal">
                <p>{endedDialogText}</p>
                <button className="btn" onClick={() => setShowEndedDialog(false)}>OK</button>
              </div>
            </div>
          )}
          {kickedOpen && (
            <div className="modal-backdrop">
              <div className="modal">
                <h2 className="modal-title">{kickedReason === "The meeting has ended for everyone." ? "Meeting Ended" : "Removed from Interview"}</h2>
                <p className="modal-text">{kickedReason}</p>
                <button
                  className="modal-button"
                  onClick={() => setKickedOpen(false)}
                >
                  OK
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        {/* Left side */}
        <div className="left" style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <img
              src="/images/NR logo.png"
              alt="AIRA Connect"
              style={{ height: 38, objectFit: "contain" }}
            />

            <span style={{
              fontSize: 9,
              color: "var(--neutral-700)",
              fontWeight: 400,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              alignSelf: "center",
            }}>
              Powered by AIRA
            </span>
          </div>

          {/* Vertical divider */}
          <div
            style={{
              height: "32px",
              width: "1px",
              backgroundColor: "var(--border-medium)",
              margin: "0 16px",
            }}
          ></div>


          {/* Recording indicator */}
          <div
            className="recording-indicator"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              gap: 6,
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "6px",
              marginTop: "10px",

            }}
          >
            <div
              className="recording-dot"
              style={{
                width: 7,
                height: 7,
                background: "#dc2626",
                borderRadius: "50%",
                animation: "recordingBlink 2s infinite",
                flexShrink: 0,
                // alignItems: "bottom",
                // position: "relative",
                // top: "10px",  
              }}
            ></div>
            <span
              className="recording-text"
              style={{
                fontSize: 12,
                fontWeight: 200,
                color: "#dc2626",
                lineHeight: 1,
                whiteSpace: "nowrap",
              }}
            >
              Recording
            </span>
          </div>

        </div>

        <div className="right" >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Profile */}
            <div
              style={{
                marginRight: 16,                //  move margin to the right
                paddingRight: 16,               //  padding on right
                borderRight: "1px solid var(--border-light)", //  divider on right side
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                className="profile"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  color: "var(--neutral-800)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, justifyContent: "center" }}>
                  <span
                    className="profile-name"
                    style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}
                  >
                    {name}
                  </span>
                  <span
                    className="profile-role"
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "var(--neutral-500)",
                      lineHeight: 1.2,
                      textTransform: "capitalize"
                    }}
                  >
                    {role}
                  </span>
                  <div
                  // className="role-circle"
                  // style={{
                  //   display: "flex",
                  //   justifyContent: "center",
                  //   alignItems: "center",
                  //   width: 32,
                  //   height: 32,
                  //   borderRadius: "50%",
                  //   background: "var(--surface-brand)",
                  //   color: "white",
                  //   fontWeight: 600,
                  //   fontSize: 14,
                  //   textTransform: "uppercase",
                  // }}
                  >
                    {/* {role ? role.charAt(0).toUpperCase() : ""} */}
                  </div>
                </div>
              </div>
            </div>

            {/* Mic Button */}
            <button
              className={`btn icon mic ${muted ? "muted" : "unmuted"}`}
              onClick={toggleMic}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute" : "Mute"}
              aria-pressed={!muted}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </button>

            {/* Cam Button */}
            <button
              className={`btn icon cam ${videoOff ? "off" : "on"}`}
              onClick={toggleCam}
              aria-label={videoOff ? "Start video" : "Stop video"}
              title={videoOff ? "Start video" : "Stop video"}
              aria-pressed={!videoOff}
            >
              {videoOff ? <VideoOffIcon /> : <VideoIcon />}
            </button>

            {/* Leave Button */}
            <button className="btn danger" onClick={() => setShowLeaveModal(true)}>
              Leave
            </button>
            {showLeaveModal && (
              <div className="modal-backdrop">
                <div className="modal">
                  <p>Are you sure you want to exit?</p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
                    <button className="btn" onClick={() => setShowLeaveModal(false)}>Cancel</button>
                    <button
                      className="btn danger"
                      onClick={() => {
                        leave();
                        setShowLeaveModal(false);
                      }}
                    >
                      Yes, Exit
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

      </header>

      <main className="main">
        <section className="stage">
          <div id="video-grid" className="grid">
            <div className="tile" id="wrap-self">
              <video ref={localVideoRef} autoPlay playsInline muted />
              {videoOff && (<div className="self-off" aria-label="video off" />)}
              {/* Self connection quality (candidate/recruiter sees own signal) */}
              {(r => r === 'candidate' || r === 'recruiter')(String(role || '').toLowerCase()) && (
                <div id="q-self" className="quality-badge quality-unknown" title="Connection: unknown" aria-label="Your network quality">
                  <span className="q-icon" />
                  <span className="q-label">Unknown</span>
                </div>
              )}
              {/* Icons for mute and video off */}
              <div className={`icon-overlay ${muted ? 'muted' : ''}`}>
                {muted && (
                  <MicOffIcon className="icon mic-icon" />
                )}
              </div>
              <div className={`icon-overlay ${videoOff ? 'video-off' : ''}`}>
                {videoOff && (
                  <VideoOffIcon className="icon cam-icon" />
                )}
              </div>
              <div className="overlay">
                {name || "Me"} · {role}
                {muted ? " · muted" : ""}
                {videoOff ? " · video off" : ""}
              </div>
            </div>
          </div>
        </section>

        <aside className="side">
          <div className="panel compact">
            <div className="room-info-row">
              {/* Left side — Room ID */}
              <div className="room-id">
                <div className="name">{roomId}</div>
                <div className="meta">Room ID</div>
              </div>

              {/* Right side — Timer / Duration */}
              <div className="room-timer">
                {!botJoinMs ? (
                  <span className="pill">00:00</span>
                ) : danger ? (
                  <span className="timer-wrap">
                    <span className="rec-dot" aria-label="Ending soon" />
                    <span className="timer danger">
                      <span className="timer-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                      {remainingText}
                    </span>
                  </span>
                ) : (
                  <span className="timer">{displayTime(elapsedTime)}</span>
                )}
                <div className="duration-label">Duration</div>
              </div>
            </div>
          </div>


          <div className="panel">
            <div className="panel-title">Participants</div>
            <div className="list">
              {roomState.participants.filter(p => String(p.role || "").toLowerCase() !== "sentinel").map(p => (
                <div key={p.id} className="row">
                  <div className="participant-info">
                    <div
                      className="avatar"
                      style={{ background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)" }}
                    >
                      {p.name?.slice(0, 2).toUpperCase()}
                    </div>

                    <div>
                      <div className="name">{p.name || p.id.slice(0, 6)}</div>
                      <div className="meta">{p.role}</div>
                    </div>
                  </div>
                  <div className="participant-controls">
                    {/* Mic */}
                    <button
                      className={`btn icon mic ${p.muted ? "muted" : "unmuted"}`}
                      title={p.muted ? "Muted" : "Unmuted"}
                      disabled
                    >
                      {p.muted ? <MicOffIcon /> : <MicIcon />}
                    </button>
                    {/* Cam */}
                    <button
                      className={`btn icon cam ${p.videoOff ? "off" : "on"}`}
                      title={p.videoOff ? "Video Off" : "Video On"}
                      disabled
                    >
                      {p.videoOff ? <VideoOffIcon /> : <VideoIcon />}
                    </button>
                    {/* Recruiter sees candidate's signal strength */}
                    {String(role || '').toLowerCase() === 'recruiter' && String(p.role || '').toLowerCase() === 'candidate' && (
                      <div id={`qlist-${p.id}`} className="quality-list-badge quality-unknown" title="Connection: unknown" aria-label="Network quality">
                        <span className="q-icon" />
                      </div>
                    )}
                  </div>
                </div>

              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Chat</div>
            <div className="chat-list" ref={chatListRef}>
              {chat.map((m, i) => {
                const me = (m.name || m.from || '').trim() === (name || '').trim();
                const ts = Number.isFinite(+m.ts) ? new Date(+m.ts) : null;
                const hhmm = ts ? `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}` : '';
                if (m.system) {
                  return (
                    <div key={i} className="chat-row system">
                      <span className="chat-system">{m.message || m.text}</span>
                      {hhmm && <span className="chat-time">{hhmm}</span>}
                    </div>
                  );
                }
                const prev = chat[i - 1];
                const prevName = (prev?.name || prev?.from || '').trim();
                const curName = (m.name || m.from || '').trim();
                const sameThread = !!prev && !prev.system && prevName === curName && String(prev.role || '') === String(m.role || '');
                const rowClass = `chat-row ${me ? 'me' : 'other'}${sameThread ? ' cont' : ''}`;
                return (
                  <div key={i} className={rowClass}>
                    {!sameThread && (
                      <div className="chat-meta">
                        <span className="chat-from">{curName || 'anon'}</span>
                        {m.role ? <span className="chat-role"> · {m.role}</span> : null}
                        {hhmm && <span className="chat-time"> · {hhmm}</span>}
                      </div>
                    )}
                    <div className="chat-bubble">{m.message || m.text}</div>
                  </div>
                );
              })}
            </div>

            <ChatInput onSend={sendChat} />
          </div>

          {/* Live transcript (sttClient.js appends to #stt-log) */}
          {/* <div className="panel">
            <div className="panel-title">Live transcript</div>
            <pre id="stt-log" style={{
              maxHeight: 160, overflow: "auto", background: "#0e0f13", color: "#b7ffb7",
              padding: 8, borderRadius: 8, border: "1px solid #1b1e2a", whiteSpace: "pre-wrap"
            }}>Listening…</pre>
          </div> */}

        </aside>
      </main>
      {/* 
          <div className="toolbar">
            <button
              className="btn icon"
              onClick={toggleMic}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute" : "Mute"}
              aria-pressed={!muted}
            >
              {muted ? <MicOffIcon /> : <MicIcon />}
            </button>
            <button
              className="btn icon"
              onClick={toggleCam}
              aria-label={videoOff ? "Start video" : "Stop video"}
              title={videoOff ? "Start video" : "Stop video"}
              aria-pressed={!videoOff}
            >
              {videoOff ? <VideoOffIcon /> : <VideoIcon />}
            </button>
            <div className="spacer" />
            <button className="btn danger" onClick={leave}>Leave</button>
          </div>
        </aside>
      </main> */}
      {/* Waiting for AIRA popup - shown when bot hasn't joined yet */}
      {showWaitingForBot && (
        <div className="reminder-5min" aria-live="polite">
          <div className="reminder-5min-card waiting-bot">
            <span className="timer-icon" aria-hidden="true">
              {/* <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg> */}
            </span>
            <span className="reminder-text">Waiting for AIRA to join</span>
          </div>
        </div>
      )}
      {showFiveMinReminder && (
        <div className="reminder-5min" aria-live="polite">
          <div className={"reminder-5min-card" + (fiveMinHiding ? " hide" : "")}>
            <span className="timer-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="reminder-text">Just 5 minutes remaining </span>
          </div>
        </div>
      )}
      {showReconnectModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <p>{reconnectMessage}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
              <button className="btn" onClick={() => setShowReconnectModal(false)}>Close</button>
              <button className="btn primary" onClick={handleRejoin}>Rejoin</button>
            </div>
          </div>
        </div>
      )}
      {showConsentDialog && (
        <div className="modal-backdrop">
          <div className="modal">
            <p>Please check the consent box to agree to recording before joining.</p>
            <button className="btn" onClick={() => setShowConsentDialog(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatInput({ onSend }) {
  const [val, setVal] = useState("");
  const ref = useRef(null);
  function submit() { const t = val.trim(); if (!t) return; onSend(t); setVal(""); ref.current?.focus(); }
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }
  return (
    <div className="chat-input-wrap">
      <textarea
        ref={ref}
        className="inp chat-inp"
        value={val}
        placeholder="Type a message"
        rows={1}
        onChange={e => setVal(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button className="btn" onClick={submit} aria-label="Send message" title="Send">Send</button>
    </div>
  );
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function safePlay(el) { try { const p = el.play?.(); if (p?.catch) p.catch(() => { }); } catch { } }

// --- Icons ---
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 21v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 3a3 3 0 0 1 3 3v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 10v1a7 7 0 0 1-7 7 7 7 0 0 1-7-7v-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 21v-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="5" width="13" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 9l5-3v12l-5-3V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function VideoOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="5" width="13" height="14" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M16 9l5-3v12l-5-3V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// --- Safari-safe blank preview source ---
const blankPreviewStreamRef = { current: null };

function getBlankPreviewStream() {
  if (blankPreviewStreamRef.current) return blankPreviewStreamRef.current;

  const canvas = document.createElement('canvas');
  // match your tile aspect ratio
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Key for Safari/iOS: attach canvas to DOM (offscreen) before captureStream
  try {
    canvas.style.position = 'fixed';
    canvas.style.left = '-9999px';
    canvas.style.top = '-9999px';
    canvas.style.width = '1px';
    canvas.style.height = '1px';
    canvas.style.opacity = '0';
    document.body.appendChild(canvas);
  } catch { }

  let stream = null;
  try {
    // 1 fps is enough; Safari just needs a real video track
    stream = canvas.captureStream ? canvas.captureStream(1) : null;
  } catch { }

  // Final fallback: return an empty MediaStream (we'll paint the element black via CSS)
  blankPreviewStreamRef.current = stream || new MediaStream();
  return blankPreviewStreamRef.current;
}

function refreshSelfPreviewFor(isOff) {
  const v = localVideoRef.current;
  const s = localStreamRef.current;
  if (!v) return;

  // Hard reset so Safari doesn't cache the last frame
  try { v.pause(); } catch { }
  try { v.srcObject = null; } catch { }
  try { v.removeAttribute('src'); } catch { }
  try { v.load?.(); } catch { }
  v.style.backgroundColor = '';

  if (!s) return;

  if (isOff) {
    const preview = new MediaStream();
    try { s.getAudioTracks().forEach(t => preview.addTrack(t)); } catch { }
    const blank = getBlankPreviewStream();
    const blankTrack = blank?.getVideoTracks?.()[0];
    if (blankTrack) preview.addTrack(blankTrack); else v.style.backgroundColor = 'black';
    v.srcObject = preview;
  } else {
    v.srcObject = s;
  }

  v.muted = true;
  v.playsInline = true;
  safePlay(v);
}

function detectSpeaking(stream, onChange) {
  if (!stream) return;
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const data = new Uint8Array(analyser.fftSize);

  function tick() {
    analyser.getByteTimeDomainData(data);
    const rms = Math.sqrt(
      data.reduce((s, v) => s + (v - 128) ** 2, 0) / data.length
    );
    onChange(rms > 0.085); // tweak threshold if too sensitive
    requestAnimationFrame(tick);
  }
  tick();
}

function injectStyles() {
  if (document.getElementById("aira-styles")) return;
  const css = `
:root { 
  color-scheme: light;
  
  /* Typography Scale */
  --font-size-xs: 10px;
  --font-size-sm: 11px;
  --font-size-base: 13px;
  --font-size-md: 14px;
  --font-size-lg: 15px;
  --font-size-xl: 16px;
  
  /* Font Weights */
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  
  /* Primary palette */
  --primary: #4f46e5;
  --primary-light: #6366f1;
  --primary-dark: #3730a3;
  --primary-subtle: #eef2ff;
  
  /* Secondary palette */
  --secondary: #059669;
  --secondary-light: #10b981;
  --secondary-subtle: #ecfdf5;
  
  /* Status colors */
  --success: #22c55e;
  --success-subtle: #f0fdf4;
  --warning: #f59e0b;
  --warning-subtle: #fffbeb;
  --danger: #ef4444;
  --danger-subtle: #fef2f2;
  
  /* Neutral palette */
  --neutral-0: #ffffff;
  --neutral-25: #fcfcfd;
  --neutral-50: #f8f9fb;
  --neutral-100: #f1f3f7;
  --neutral-200: #e4e7ec;
  --neutral-300: #d0d5dd;
  --neutral-400: #98a2b3;
  --neutral-500: #667085;
  --neutral-600: #475467;
  --neutral-700: #344054;
  --neutral-800: #1d2939;
  --neutral-900: #101828;
  
  /* Surface colors */
  --surface-primary: #ffffff;
  --surface-secondary: #fafbfc;;
  --surface-tertiary: #f5f6f8;
  --surface-brand: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
  
  /* Borders & Shadows */
  --border-light: #f1f3f7;
  --border-medium: #e4e7ec;
  --border-strong: #d0d5dd;
  
  --shadow-xs: 0 1px 2px 0 rgb(16 24 40 / 0.04);
  --shadow-sm: 0 1px 3px 0 rgb(16 24 40 / 0.08), 0 1px 2px -1px rgb(16 24 40 / 0.08);
  --shadow-md: 0 4px 8px -2px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.08);
  --shadow-lg: 0 12px 16px -4px rgb(16 24 40 / 0.08), 0 4px 6px -2px rgb(16 24 40 / 0.04);
  --shadow-xl: 0 20px 24px -4px rgb(16 24 40 / 0.08), 0 8px 8px -4px rgb(16 24 40 / 0.04);
  
  --border-radius: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
}

* { box-sizing: border-box; }
html, body, #root {
  height: 100%;
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-feature-settings: 'cv02','cv03','cv04','cv11';
  font-size: var(--font-size-base);
  line-height: 1.5;
  overflow: hidden;
}
.app {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  background: var(--neutral-25);
  color: var(--neutral-900);
  height:100vh;
  overflow: hidden; /* keeps children contained */
}

/*----------------------Join card----------------- */

/* Fullscreen join background */
.join {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 24px;
  background: linear-gradient(
    135deg,
    var(--surface-secondary) 0%,
    var(--neutral-50) 100%
  );
}

/* The join card */
.join-card {
  position: relative;
  background: var(--surface-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-xl);
  padding: 32px 36px;
  width: 100%;
  max-width: 440px;

  display: flex;
  flex-direction: column;
  gap: 20px;
  animation: fadeInUp 0.3s ease-out;
}

/* Accent bar */
.join-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--surface-brand);
  border-radius: var(--border-radius-xl) var(--border-radius-xl) 0 0;
}

/* Heading */
.join-card > div:first-child {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-semibold);
  color: var(--neutral-900);
  text-align: center;
  margin-bottom: 4px;
}

/* Form rows - vertical stack */
.join-card .row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.join-card label {
  font-size: var(--font-size-md);       /* bigger than sm/base */
  font-weight: var(--font-weight-semibold);
  color: var(--neutral-800);
  min-width: 120px;  
}

/* Inputs */
.join-card .inp {
  border: 1px solid var(--border-medium);
  border-radius: var(--border-radius);
  padding: 10px 12px;
  font-size: var(--font-size-base);
  background: var(--neutral-0);
  color: var(--neutral-900);
  flex: 1;
}

.join-card .row.button-row {
  justify-content: center;              /* center button horizontally */
}

/* Consent box - rich style from first version */
.consent {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 8px;
  font-size: var(--font-size-sm);
  line-height: 1.5;
  color: var(--neutral-600);

  padding: 16px;
  background: var(--surface-tertiary);
  border-radius: var(--border-radius-lg);
  border: 1px solid var(--border-light);
}
.consent input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
  margin-top: 2px;
}

/* Alerts - full system style */
.alert {
  padding: 12px 16px;
  border-radius: var(--border-radius-lg);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  border: 1px solid;
}
.alert.warn {
  background: var(--warning-subtle);
  border-color: var(--warning);
  color: #b45309;
}
.alert.error {
  background: var(--danger-subtle);
  border-color: var(--danger);
  color: #dc2626;
}
.alert.hidden { display: none; }

/* Primary join button */
.join-card .btn.primary {
  background: var(--primary);
  border: 1px solid var(--primary);
  color: var(--neutral-0);
  font-weight: var(--font-weight-semibold);
  border-radius: var(--border-radius);
  padding: 12px 28px;
  font-size: var(--font-size-md);
  transition: background 0.2s ease, transform 0.1s ease;
}
.join-card .btn.primary:hover {
  background: var(--primary-dark);
  transform: translateY(-1px);
}
.join-card .btn.primary:active {
  transform: translateY(0);
}

/* Fade-in animation */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Responsive */
@media (max-width: 480px) {
  .join-card {
    padding: 20px 24px;
    max-width: 95%;
  }
}



/* -------------------- Topbar -------------------- */
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-light);
  background: var(--surface-primary);
  position: sticky;
  top: 0;
  z-index: 10;
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(8px);
}
.left {
  display: flex;
  gap: 16px;
  align-items: center;
}
.left strong {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  background: var(--surface-brand);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: -0.025em;
}
.center {
  display: flex;
  gap: 20px;
  align-items: center;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
}


/* Mic button muted state */
.topbar .btn.icon.mic.muted {
  background: var(--danger-subtle);  /* Background color */
  border-color: var(--danger);      /* Border color */
  color: var(--danger);             /* Text (icon) color */
}

/* Mic button unmuted state */
.topbar .btn.icon.mic.unmuted {
  background: var(--surface-primary);  /* Default background */
  border-color: var(--border-light);   /* Default border */
  color: var(--neutral-900);           /* Default icon color */
}

/* Cam button off state */
.topbar .btn.icon.cam.off {
  background: var(--danger-subtle);  /* Background color for 'video off' state */
  border-color: var(--danger);       /* Border color for 'video off' state */
  color: var(--danger);              /* Icon color for 'video off' state */
}

/* Cam button on state */
.topbar .btn.icon.cam.on {
  background: var(--surface-primary);  /* Default background for 'video on' state */
  border-color: var(--border-light);   /* Default border color */
  color: var(--neutral-900);           /* Default icon color */
}


/* Hover state for both Mic buttons */
.topbar .btn.icon.mic:hover {
  background: var(--danger-subtle);   /* Background change on hover for muted state */
  border-color: var(--danger);        /* Border color change on hover */
  transform: scale(1.1);
}

/* Hover state for both Cam buttons */
.topbar .btn.icon.cam:hover {
  background: var(--danger-subtle);   /* Background change on hover for 'video off' state */
  border-color: var(--danger);        /* Border color change on hover */
  transform: scale(1.1);
}



/* -------------------- Pills -------------------- */
.pill {
  margin-left: 12px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  background: var(--surface-tertiary);
  color: var(--neutral-700);
  border: 1px solid var(--border-light);
  transition: all 0.2s ease;
}
.pill:hover { background: var(--neutral-100); border-color: var(--border-medium); }
.pill.role { background: var(--primary-subtle); color: var(--primary-dark); border-color: var(--primary-light); }

/* -------------------- Inputs & Buttons -------------------- */
.inp {
  background: var(--surface-primary);
  border: 1px solid var(--border-medium);
  color: var(--neutral-900);
  padding: 10px 14px;
  border-radius: var(--border-radius);
  width: 100%;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-normal);
  transition: all 0.2s ease;
  box-shadow: var(--shadow-xs);
}
.inp:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-subtle), var(--shadow-sm);
}
.inp:hover { border-color: var(--border-strong); }
.btn {
  background: var(--surface-primary);
  border: 1px solid var(--border-medium);
  color: var(--neutral-700);
  padding: 10px 18px;
  border-radius: var(--border-radius);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-medium);
  transition: all 0.2s ease;
  box-shadow: var(--shadow-xs);
}
.btn:hover {
  background: var(--surface-secondary);
  border-color: var(--border-strong);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: white;
  box-shadow: var(--shadow-sm);
}
.btn.primary:hover { background: var(--primary-dark); border-color: var(--primary-dark); box-shadow: var(--shadow-md); }
.btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: white;
  box-shadow: var(--shadow-sm);
}
.btn.danger:hover { background: #dc2626; border-color: #dc2626; box-shadow: var(--shadow-md); }
.btn.icon {
  width: 44px;
  height: 44px;
  padding: 10px;
  border-radius: var(--border-radius-lg);
}
.btn.icon svg { width: 20px; height: 20px; display: block; }
.btn.icon:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }

/* -------------------- Grid & Tiles -------------------- */
.main {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 0px;
  padding: 16px;
  flex: 1;
  max-width: 1440px;
  margin: 0 auto;
  width: 100%;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}
.stage {
  border: 1px solid var(--border-light);
  border-radius: var(--border-radius-xl);
  background: var(--surface-primary);
  box-shadow: var(--shadow-md);
  /* allow it to scroll only within the remaining space */
  overflow: hidden;
  min-height: 0;
  height: 100%;       
  flex: 1;  
  overflow: hidden; 
  display: flex;
}
.grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
  padding: 12px;
  align-items: start;
  overflow: hidden;
  width: 100%;
  height: 100%;
  place-items: center;
}

.grid.center-last {
  justify-items: center;  /* center orphan tile(s) in last row */
}

/*.icon-overlay {
  position: absolute;
  top: 10px;  /* adjust for positioning */
  left: 10px;
  display: flex;
  gap: 8px;
  z-index: 2;  /* Keep above the video */
}*/

.icon-overlay.muted {
  left: 10px;
}

.icon-overlay.video-off {
  right: 10px;
}

/* Style for mic off icon */
.icon.mic-icon {
  width: 24px;
  height: 24px;
  color: var(--danger);  /* Red color for muted state */
}

/* Style for video off icon */
.icon.cam-icon {
  width: 24px;
  height: 24px;
  color: var(--danger);  /* Red color for video off state */
}

/* Remote participant icons */
.remote-icons {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 6px;
  z-index: 2;
}

.remote-icon-badge {
  width: 28px;
  height: 28px;
  background: rgba(239, 68, 68, 0.95);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(4px);
}

.remote-icon-badge svg {
  width: 16px;
  height: 16px;
  color: white;
}

/* Connection quality badge (per tile) */
.quality-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(255,255,255,0.95);
  border: 1px solid var(--border-light);
  border-radius: 9999px;
  padding: 6px 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  z-index: 2;
  box-shadow: var(--shadow-sm);
}
.quality-badge .q-icon { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; }
.quality-badge .q-icon svg { width: 16px; height: 16px; display: block; }
.quality-badge .q-label { font-size: 12px; color: var(--neutral-800); line-height: 1; }
.quality-good .q-icon { color: #16a34a; }
.quality-ok .q-icon   { color: #f59e0b; }
.quality-poor .q-icon { color: #dc2626; }
.quality-unknown .q-icon { color: #9ca3af; }
.quality-disconnected .q-icon { color: #6b7280; }

.tile {
  position: relative;
  background: var(--neutral-900);
  border-radius: var(--border-radius-lg);
  aspect-ratio: 16 / 9;
  width: 100%;       /* keep */
  height: 100%;      /* keep */
  min-width: 0;      /* was 100% — must be 0 so we can set a pixel width when centering */
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 2px solid var(--border-medium);
  box-shadow: var(--shadow-sm);
  transition: all 0.3s ease;
}
.tile:hover { border-color: var(--primary-light); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.tile video, .tile audio, .tile .video-placeholder {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Active speaker highlight */
.tile.speaking {
  border: 3px solid var(--primary);
  box-shadow: 0 0 12px 3px rgba(33, 23, 221, 0.6);
  transition: border 0.2s ease, box-shadow 0.2s ease;
}

.video-placeholder {
  background: linear-gradient(135deg, var(--neutral-800) 0%, var(--neutral-700) 100%);
  color: var(--neutral-400);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-base);
}
.self-off { position: absolute; inset: 0; background: var(--neutral-900); }

/* Bot Tile Special */
.tile.bot::after {
  content: "AIRA";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--font-weight-semibold);
  font-size: 30px;
  color: white;
  text-transform: uppercase;
  background: rgba(22, 141, 220, 0.7);
  z-index: 1;
  pointer-events: none;
  letter-spacing: 0.15em;
  text-shadow: 0 2px 4px rgba(0,0,0,0.3);
}

/* -------------------- Overlay Controls -------------------- */
.fullscreen-btn { 
  position: absolute; 
  bottom: 12px; 
  right: 12px; 
  background: rgba(255,255,255,0.95); 
  color: var(--neutral-700); 
  border: 1px solid var(--border-light); 
  padding: 6px 10px; 
  border-radius: var(--border-radius); 
  cursor: pointer; 
  z-index: 2; 
  font-size: var(--font-size-xs); 
  font-weight: var(--font-weight-medium);
  backdrop-filter: blur(8px); 
  transition: all 0.2s ease;
  box-shadow: var(--shadow-sm);
}
.fullscreen-btn:hover { background: var(--surface-primary); border-color: var(--border-medium); transform: scale(1.05); box-shadow: var(--shadow-md); }
.overlay {
  position: absolute;
  left: 12px;
  bottom: 12px;
  background: rgba(255,255,255,0.95);
  color: var(--neutral-800);
  padding: 8px 14px;
  border-radius: var(--border-radius-lg);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  z-index: 2;
  backdrop-filter: blur(8px);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
}


/* -------------------- Side Panels -------------------- */
.side {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: hidden; 
  min-height: 0;          /* 🔑 allows children to shrink */
  height: 100%; 
}
.panel {
  background: var(--surface-primary);
  border: 2px solid #e2e8f0;
  padding: 12px;
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-md);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0; 
}
.panel::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%);
}
.panel-title {
  font-weight: var(--font-weight-bold);
  margin-bottom: 10px;
  color: var(--neutral-900);
  font-size: var(--font-size-lg);
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 8px;
}
.panel.compact { padding: 8px; }
.panel.compact .panel-title {
  margin-bottom: 8px;
  padding-bottom: 6px;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
}
.panel .list,
.chat-list {
  flex: 1;                /* take available space */
  min-height: 0;
  overflow-y: auto;       /* scroll only inside here */
}

/* -------------------- Recording Indicator -------------------- */
.recording-indicator {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--border-radius);
  margin-bottom: 8px;
}
.recording-dot {
  width: 8px;
  height: 8px;
  background: #dc2626;
  border-radius: 50%;
  animation: recordingBlink 2s infinite;
  
}
.recording-text {
  font-size: 12px;
  color: #dc2626;
  font-weight: 500;
}
@keyframes recordingBlink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0.3; }
}

/* -----------------------Room Info Styles------------------- */
.room-info-row {
  display: flex;
  align-items: center;        /* vertical alignment */
  justify-content: space-between;
  background: var(--surface-secondary);
  border: 1px solid var(--border-light);
  padding: 10px 12px;
  border-radius: var(--border-radius-lg);
  transition: all 0.2s ease;
}

.room-info-row:hover {
  background: var(--surface-secondary);
  border-color: var(--border-medium);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.room-id .name {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-base);
  color: var(--neutral-900);
}

.room-id .meta {
  font-size: var(--font-size-xs);
  color: var(--neutral-500);
  margin-top: 2px;
}

.room-timer {
  text-align: right;
  font-family: 'SF Mono','Monaco','Inconsolata','Roboto Mono',monospace;
}

.room-timer .timer {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--neutral-800);
}

.room-timer .timer.danger {
  color: var(--danger);
}

.room-timer .duration-label {
  font-size: var(--font-size-xs);
  color: var(--neutral-500);
  margin-top: 2px;
}
 .list{display:flex;flex-direction:column;gap:6px;max-height:30vh;overflow:auto}
                .row{display:flex;align-items:center;justify-content:space-between;background:var(--surface-secondary);border:1px solid var(--border-light);padding:10px 12px;border-radius:var(--border-radius-lg);transition:all 0.2s ease}
        .row:hover{background:var(--surface-secondary);border-color:var(--border-medium);transform:translateY(-1px);box-shadow:var(--shadow-sm)}
        .row .name{color:var(--neutral-900);font-size:var(--font-size-sm);font-weight:var(--font-weight-semibold)}
        .row .meta{color:var(--neutral-500);font-size:var(--font-size-xs);font-weight:var(--font-weight-normal)}



/* -----------------------Participants--------------------------- */
/* Avatar */
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-brand); /* fallback */
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: 12px;
  flex-shrink: 0;
}

/* Participant info wrapper */
.participant-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

/* Name + role stacked */
.row .name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: var(--neutral-900);
}
.row .meta {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-normal);
  color: var(--neutral-500);
}

/* Controls */
.participant-controls {
  display: flex;
  gap: 4px;
  align-items: center;
}

/* Compact mic/cam buttons */
.participant-controls .btn.icon {
  width: 24px;
  height: 24px;
  padding: 4px;
  border-radius: 50%;
  box-shadow: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.participant-controls .btn.icon svg {
  width: 12px;
  height: 12px;
}

/* Color mapping for list badge */
.quality-good .q-icon { color: #16a34a; }
.quality-ok .q-icon   { color: #f59e0b; }
.quality-poor .q-icon { color: #dc2626; }
.quality-unknown .q-icon { color: #9ca3af; }
.quality-disconnected .q-icon { color: #6b7280; }

/* Compact quality badge for Participants list */
.quality-list-badge { display: inline-flex; align-items: center; justify-content: center; margin-left: 6px; }
.quality-list-badge .q-icon { display: inline-flex; width: 14px; height: 14px; align-items: center; justify-content: center; }
.quality-list-badge .q-icon svg { width: 14px; height: 14px; display: block; }

/* State coloring */
.btn.icon.mic.muted {
  color: var(--neutral-400);
}
.btn.icon.cam.off {
  color: var(--neutral-400);
}



/* -------------------- Chat -------------------- */
/* Chat - Professional messaging design */
        .chat-list{display:flex;flex-direction:column;gap:6px;max-height:35vh;overflow:auto;border:1px solid var(--border-light);border-radius:var(--border-radius-lg);padding:10px;background:var(--surface-tertiary)}
        .chat-row{display:flex;flex-direction:column;gap:4px}
        .chat-row.cont{gap:3px}
        .chat-row.cont .chat-meta{display:none}
        .chat-row.me{align-items:flex-end}
        .chat-row.other{align-items:flex-start}
        .chat-row.system{align-items:center;opacity:.95}
        .chat-meta{font-size:var(--font-size-xs);color:var(--neutral-500);margin-bottom:2px;font-weight:var(--font-weight-normal)}
        .chat-from{font-weight:500;color:var(--neutral-700)}
        .chat-role{opacity:.8}
        .chat-time{opacity:.7}
        .chat-bubble{max-width:85%;white-space:pre-wrap;padding:8px 12px;border-radius:var(--border-radius-lg);font-size:var(--font-size-sm);font-weight:var(--font-weight-normal);line-height:1.4;box-shadow:var(--shadow-sm);border:1px solid;transition:all 0.2s ease}
        .chat-row.me .chat-bubble{background:var(--primary);color:white;border-color:var(--primary-dark)}
        .chat-row.me .chat-bubble:hover{transform:translateY(-1px);box-shadow:var(--shadow-md)}
        .chat-row.other .chat-bubble{background:var(--surface-primary);color:var(--neutral-900);border-color:var(--border-medium)}
        .chat-row.other .chat-bubble:hover{background:var(--surface-secondary);border-color:var(--border-strong)}
        .chat-row.system .chat-system{font-size:var(--font-size-sm);font-weight:var(--font-weight-normal);color:var(--neutral-600);background:var(--secondary-subtle);padding:10px 14px;border-radius:var(--border-radius-lg);border:1px solid var(--secondary-light);font-style:italic}
        .chat-input-wrap{display:flex;gap:8px;margin-top:10px;align-items:flex-end}
        .chat-inp{min-height:36px;max-height:100px;resize:vertical;border-radius:var(--border-radius-lg);flex:1}
        .chat-input-wrap .btn{background:var(--primary);color:white;border-color:var(--primary);min-width:60px;height:36px;font-weight:var(--font-weight-medium)}


/* -------------------- Toolbar -------------------- */
.toolbar {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  border-top: 1px solid var(--border-light);
  background: var(--surface-primary);
  flex-wrap: wrap;
  box-shadow: 0 -4px 8px -2px rgb(16 24 40 / 0.08);
  backdrop-filter: blur(8px);
}
.toolbar .spacer { flex: 1; }

/* -------------------- Timer -------------------- */
.timer { font-variant-numeric: tabular-nums; font-weight: 600; color: var(--neutral-700); }
.timer.danger { color: var(--danger); }
.rec-dot { width: 12px; height: 12px; background: var(--secondary); border-radius: 50%; animation: pulse 1.6s infinite; }
.rec-text { color: var(--secondary); font-weight: 600; }
@keyframes pulse { 0%{transform:scale(1)} 50%{transform:scale(1.8)} 100%{transform:scale(1)} }

/* Waiting for bot reminder */
.reminder-5min-card.waiting-bot {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fef2f2;  /* Gradient background for bot waiting */
  border: 1px solid #fecaca;  /* Light border */
  color: #dc2626;  /* Text color */
  padding: 8px 8px;
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-xl);
  font-weight: var(--font-weight-small);
  font-size: var(--font-size-base);
  transition: opacity .45s ease, transform .45s ease;
  animation: waitingPulse 2s ease-in-out infinite;  /* Pulse animation */
  position: absolute;
  
}


/* Icon styling for waiting bot reminder */
.reminder-5min-card.waiting-bot .timer-icon svg {
  color: white;
  width: 24px;
  height: 24px;
  margin-right: 2px;
}

/* Pulse animation for waiting bot reminder */
@keyframes waitingPulse {
  0%, 100% { opacity: 1; transform: translateY(0) scale(1); }
  50% { opacity: 0.9; transform: translateY(0) scale(1.02); }
}

/* Optional hiding animation */
.reminder-5min-card.waiting-bot.hide {
  opacity: 0;
  transform: translateY(-16px);
}

/* Icon before content (change the icon to suit your design) */
.reminder-5min-card.waiting-bot::before {
  content: '⏳'; /* Hourglass icon for waiting */
  font-size: var(--font-size-xl);
}



/* -------------------- Reminder -------------------- */
.reminder-5min { position: fixed; left: 0; right: 0; top: 24px; display: flex; justify-content: center; z-index: 999; pointer-events: none; }
.reminder-5min-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--warning-subtle);
  border: 1px solid var(--warning);
  color: var(--neutral-900);
  padding: 16px 24px;
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-xl);
  font-weight: var(--font-weight-medium);
  font-size: var(--font-size-base);
  transition: opacity .45s ease, transform .45s ease;
  animation: reminderIn .3s ease-out;
}
.reminder-5min-card::before { content: '⏰'; font-size: var(--font-size-xl); }
.reminder-5min-card.hide { opacity: 0; transform: translateY(-16px); }
@keyframes reminderIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

/* -------------------- Modal -------------------- */
.modal-backdrop {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(16, 24, 40, 0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; backdrop-filter: blur(8px);
}
.modal {
  background: var(--surface-primary);
  padding: 36px 44px;
  border-radius: var(--border-radius-xl);
  box-shadow: var(--shadow-xl);
  text-align: center;
  border: 1px solid var(--border-light);
  max-width: 520px;
  margin: 24px;
  position: relative;
}
.modal::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; background:var(--surface-brand); border-radius: var(--border-radius-xl) var(--border-radius-xl) 0 0; }
.modal p { font-size: var(--font-size-lg); line-height: 1.6; margin-bottom: 28px; color: var(--neutral-700); }


/* --- Responsive tweaks --- */

/* Medium screens: narrower side panel */
@media (max-width: 1024px) {
  .main { grid-template-columns: 1fr 280px; }
  .grid { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
}

/* Small devices: stack sidebar below stage, tiles adapt to smaller min tile widths */
@media (max-width: 768px) {

  .topbar {
    flex-wrap: wrap;          /*  allow items to move to a new line */
    gap: 8px;                 /*  add spacing when wrapped */
    padding: 12px 16px;       /*  reduce padding on small screens */
  }

  .topbar .left,
  .topbar .right {
    flex: 1 1 100%;           /*  make them full width on wrap */
    justify-content: space-between;
  }

  .topbar .right {
    gap: 8px;                 /*  tighten spacing for icons/profile */
    flex-wrap: wrap;          /*  right section also wraps if needed */
  }

  .btn.icon {
    width: 36px;              /*  shrink icon buttons */
    height: 36px;
    padding: 6px;
  }

  .btn.icon svg {
    width: 18px;
    height: 18px;
  }


  html, body, .app {
    overflow: auto;   /* ✅ allow browser scrolling on mobile */
    height: auto;     /* ✅ let content define height */
    min-height: 100vh;
  }

  .main {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto; /* stage on top, side below */
    overflow: visible;             /* don’t clip */
  }

  .side {
    max-height: none;
    overflow: visible;             /* let side panels expand */
  }

  .stage {
    height: auto;
    min-height: 200px;             /* reasonable minimum */
  }
}


/* Very small phones */
@media (max-width: 480px) {
  .tile { min-height:100px; aspect-ratio: 4 / 3; } /* slightly squarer on very small screens */
  .btn { padding: 6px 10px; font-size: 14px; }
  .pill { font-size: 10px; padding: 1px 6px; }
  .inp { font-size: 14px; padding: 5px 6px; }
}
`;
  const style = document.createElement("style");
  style.id = "aira-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
// Helpers for internet quality
const levelFromRtt = (ms) => {
  if (ms == null) return 'unknown';
  if (ms <= 150) return 'good';
  if (ms <= 400) return 'ok';
  return 'poor';
};
const strengthFromLevel = (lvl) => lvl === 'good' ? 3 : lvl === 'ok' ? 2 : lvl === 'poor' ? 1 : 1;
