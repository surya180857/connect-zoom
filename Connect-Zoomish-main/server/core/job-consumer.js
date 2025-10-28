// job-consumer.js
const { spawn } = require('child_process');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

(async () => {
  console.log('[worker] waiting for jobs...');
  while (true) {
    const [, payload] = await redis.brpop('aira:jobs', 0);
    try {
      const job = JSON.parse(payload);
      const env = {
        ...process.env,
        ROOM_ID: job.room,
        ROLE: job.role || 'bot',
        DURATION_MIN: String(job.duration_min || 10),
        SIGNALING_URL: process.env.SIGNALING_URL,
        OUT_DIR: process.env.OUT_DIR || '/opt/aira/recordings'
      };
      const child = spawn('node', ['runner.js'], { env, stdio: 'inherit' });
      child.on('exit', code => console.log('[runner exit]', job.room, code));
    } catch (e) {
      console.error('[job error]', e);
    }
  }
})();

