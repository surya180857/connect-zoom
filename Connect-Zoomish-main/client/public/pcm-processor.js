// client/public/pcm-processor.js
class PCMDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inRate = sampleRate; // typically 48000
    this.outRate = 16000;
    this.ratio = this.inRate / this.outRate; // ~3
  }

  _downsampleFloat32(f32) {
    const outLen = Math.floor(f32.length / this.ratio);
    const out = new Float32Array(outLen);
    for (let o = 0; o < outLen; o++) {
      const start = Math.floor(o * this.ratio);
      const end = Math.floor((o + 1) * this.ratio);
      let sum = 0;
      for (let i = start; i < end && i < f32.length; i++) sum += f32[i];
      out[o] = sum / Math.max(1, end - start);
    }
    return out;
  }

  _f32ToInt16LE(f32) {
    const buf = new ArrayBuffer(f32.length * 2);
    const dv = new DataView(buf);
    for (let i = 0; i < f32.length; i++) {
      let s = Math.max(-1, Math.min(1, f32[i]));
      dv.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const mono = input[0];
    const down = this._downsampleFloat32(mono);

    const CHUNK = 320; // 20ms @16kHz
    for (let i = 0; i + CHUNK <= down.length; i += CHUNK) {
      const slice = down.subarray(i, i + CHUNK);
      const bytes = this._f32ToInt16LE(slice);
      this.port.postMessage(bytes, [bytes.buffer]);
    }
    return true;
  }
}
registerProcessor('pcm-downsampler', PCMDownsampler);

