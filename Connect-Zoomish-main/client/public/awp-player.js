// public/awp-player.js
class Pcm16PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(0);
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'push') {
        const chunk = new Int16Array(e.data.payload);
        const merged = new Int16Array(this.buffer.length + chunk.length);
        merged.set(this.buffer, 0);
        merged.set(chunk, this.buffer.length);
        this.buffer = merged;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0]; // mono
    const need = out.length;
    if (this.buffer.length >= need) {
      for (let i = 0; i < need; i++) out[i] = this.buffer[i] / 32768;
      this.buffer = this.buffer.subarray(need);
    } else {
      for (let i = 0; i < need; i++) out[i] = 0;
    }
    return true;
  }
}
registerProcessor('pcm16-player', Pcm16PlayerProcessor);
