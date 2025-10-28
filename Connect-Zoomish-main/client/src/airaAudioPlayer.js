// client/src/airaAudioPlayer.js
// Plays PCM16 from relay `/audio` over WS and (optionally) publishes it to the room via WebRTC.
// Usage in App.jsx (example):
//   import { startAiraAudioPlayer } from "./airaAudioPlayer";
//   await startAiraAudioPlayer({
//     sessionId: rid,
//     relayOrigin: "https://connectdev.airahr.ai",
//     pc,                 // pass your RTCPeerConnection to publish to room
//     monitor: false      // set true to also play locally from speakers
//   });

export async function startAiraAudioPlayer({ sessionId, relayOrigin, pc, monitor = false }) {
  const relay = relayOrigin || (typeof window !== "undefined" && window.RELAY_ORIGIN) || "https://connectdev.airahr.ai";

  // IMPORTANT: relay expects ?session= (not ?session_id=)
  const wsUrl = relay.replace(/^http/, "ws") + "/audio?session=" + encodeURIComponent(sessionId);

  const AudioCtx = (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext));
  if (!AudioCtx) throw new Error("Web Audio API not available");

  const SAMPLE_RATE = 48000; // matches relay output
  const audioCtx = new AudioCtx({ sampleRate: SAMPLE_RATE });

  let ws, node, sp, cleanup;

  function sendHello() {
    try {
      // Be generous: include both keys so either server style is happy.
      ws?.send(JSON.stringify({ type: "hello", session: sessionId, session_id: sessionId, sample_rate_hz: SAMPLE_RATE }));
      console.log("[/audio] ctrl hello sent", { sessionId, sample_rate_hz: SAMPLE_RATE });
    } catch (e) {
      console.warn("[/audio] failed to send hello", e);
    }
  }

  // Create sinks: a destination for publishing to WebRTC (dest),
  // and (optionally) a local speaker monitor.
  const gain = audioCtx.createGain();
  gain.gain.value = 1.0;

  // MediaStreamDestination so we can publish to the room
  const dest = audioCtx.createMediaStreamDestination();
  gain.connect(dest);

  // Optionally also play locally to speakers for monitoring
  if (monitor) {
    const monitorGain = audioCtx.createGain();
    monitorGain.gain.value = 1.0;
    gain.connect(monitorGain);
    monitorGain.connect(audioCtx.destination);
  }

  // If we have a PeerConnection, publish the outbound track so participants hear it
  if (pc) {
    try {
      const track = dest.stream.getAudioTracks()[0];
      pc.addTrack(track, dest.stream);
      console.log("[/audio] published TTS track to room");
    } catch (e) {
      console.warn("[/audio] failed to add track to pc", e);
    }
  } else {
    console.log("[/audio] no RTCPeerConnection provided; TTS will be local-only (monitor:", !!monitor, ")");
  }

  async function startWithWorklet() {
    await audioCtx.audioWorklet.addModule("/awp-player.js");
    node = new AudioWorkletNode(audioCtx, "pcm16-player");
    node.connect(gain);

    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("[/audio] ws open", ws.url);
      sendHello(); // relay expects a hello/control
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        node.port.postMessage({ type: "push", payload: ev.data });
      } else {
        // optional: log control acks
        try { const m = JSON.parse(ev.data); if (m?.type) console.log("[/audio] ctrl", m); } catch {}
      }
    };
    ws.onclose = (e) => console.warn("[/audio] ws closed", e.code, e.reason);
    ws.onerror = (e) => console.warn("[/audio] ws error", e);

    cleanup = () => {
      try { ws && ws.close(); } catch {}
      try { node && node.disconnect(); } catch {}
      try { audioCtx && audioCtx.close(); } catch {}
    };
  }

  async function startWithScriptProcessor() {
    console.warn("[/audio] falling back to ScriptProcessor");
    sp = audioCtx.createScriptProcessor(4096, 0, 1);

    let ring = new Int16Array(0);
    sp.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      const need = out.length;
      if (ring.length >= need) {
        for (let i = 0; i < need; i++) out[i] = ring[i] / 32768;
        ring = ring.subarray(need);
      } else {
        for (let i = 0; i < need; i++) out[i] = 0;
      }
    };
    sp.connect(gain);

    ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      console.log("[/audio] ws open (fallback)", ws.url);
      sendHello(); // relay expects a hello/control
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        const chunk = new Int16Array(ev.data);
        const merged = new Int16Array(ring.length + chunk.length);
        merged.set(ring, 0);
        merged.set(chunk, ring.length);
        ring = merged;
      } else {
        try { const m = JSON.parse(ev.data); if (m?.type) console.log("[/audio] ctrl", m); } catch {}
      }
    };
    ws.onclose = (e) => console.warn("[/audio] ws closed (fallback)", e.code, e.reason);
    ws.onerror = (e) => console.warn("[/audio] ws error (fallback)", e);

    cleanup = () => {
      try { ws && ws.close(); } catch {}
      try { sp && sp.disconnect(); } catch {}
      try { audioCtx && audioCtx.close(); } catch {}
    };
  }

  try {
    await startWithWorklet();
  } catch (e) {
    console.error("Worklet init failed, trying fallback", e);
    await startWithScriptProcessor();
  }

  // Auto-resume on a user gesture / tab visible
  const resume = () => { if (audioCtx.state === "suspended") audioCtx.resume(); };
  window.addEventListener("click", resume, { once: true, capture: true });
  window.addEventListener("keydown", resume, { once: true, capture: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resume();
  });

  // Debug hooks
  if (typeof window !== "undefined") window.__airaAudio = { audioCtx, ws, node, sp, dest };

  return function stop() { cleanup && cleanup(); };
}

