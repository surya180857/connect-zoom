env SIGNALING_URL="https://aira.airahr.ai" \
    ROOM_ID="demo-room2" \
    BOT_NAME="AIRA Bot2" \
    ROLE="observer" \
    REC_OUT_DIR="/var/recordings" \
    REC_WIDTH=1280 REC_HEIGHT=720 REC_FPS=25 \
    DURATION_MIN=60 \
node ../bots/runner.cjs

