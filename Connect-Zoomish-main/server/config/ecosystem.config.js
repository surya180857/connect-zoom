// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "aira-bot",
      script: "../bots/runner.cjs",
      instances: 1,           // 1 per room config below
      exec_mode: "fork",
      env: {
        ROLE: "bot",
        DURATION_MIN: "10",
        SIGNALING_URL: "https://aira.airahr.ai",
        OUT_DIR: "/opt/aira/recordings"
      }
    }
  ]
};

