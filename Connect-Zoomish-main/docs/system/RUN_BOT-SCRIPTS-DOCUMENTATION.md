# RUN_BOT-SCRIPTS-DOCUMENTATION.md

## Overview

The `run_bot.sh` and `run_bot1.sh` scripts automate the launching of recording bots for the AIRA video interview platform. These scripts set up all required environment variables and execute the bot logic using Node.js.

---

## Script Purpose

- **Automate bot startup** for joining and recording a specific video room.
- **Configure bot parameters** (room, name, role, recording settings) via environment variables.
- **Run the bot logic** implemented in `server/bots/runner.cjs`.

---

## Script Details

### `run_bot.sh`

```bash
env SIGNALING_URL="https://aira.airahr.ai" \
    ROOM_ID="demo-room" \
    BOT_NAME="AIRA Bot" \
    ROLE="observer" \
    REC_OUT_DIR="/var/recordings" \
    REC_WIDTH=1280 REC_HEIGHT=720 REC_FPS=25 \
    DURATION_MIN=60 \
node ../bots/runner.cjs
```

### `run_bot1.sh`

```bash
env SIGNALING_URL="https://aira.airahr.ai" \
    ROOM_ID="demo-room2" \
    BOT_NAME="AIRA Bot2" \
    ROLE="observer" \
    REC_OUT_DIR="/var/recordings" \
    REC_WIDTH=1280 REC_HEIGHT=720 REC_FPS=25 \
    DURATION_MIN=60 \
node ../bots/runner.cjs
```

---

## Environment Variables

- `SIGNALING_URL`: WebRTC signaling server URL
- `ROOM_ID`: Room to join
- `BOT_NAME`: Bot display name
- `ROLE`: Bot role (e.g., observer)
- `REC_OUT_DIR`: Directory for recordings
- `REC_WIDTH`, `REC_HEIGHT`, `REC_FPS`: Video recording parameters
- `DURATION_MIN`: Recording duration (minutes)

---

## Usage

- Run from the `server/scripts/` directory:
  ```bash
  ./run_bot.sh
  ./run_bot1.sh
  ```
- The bot joins the specified room, records video, and saves output to the configured directory.

---

## Customization

- Change `ROOM_ID`, `BOT_NAME`, or other variables to target different rooms or bot identities.
- Adjust recording parameters for different video quality or duration.

---

## Dependencies

- Requires Node.js and backend dependencies installed.
- Bot logic is implemented in `server/bots/runner.cjs`.

---

## Related Documentation

- [RUNNER-DOCUMENTATION.md](./RUNNER-DOCUMENTATION.md) — Details of the bot logic
- [SERVER-DOCUMENTATION.md](./SERVER-DOCUMENTATION.md) — Backend server details

---

_Last updated: August 24, 2025_
