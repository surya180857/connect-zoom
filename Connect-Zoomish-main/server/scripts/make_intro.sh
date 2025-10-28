#!/bin/bash
set -e

# Ensure gTTS and ffmpeg are installed
pip3 install --quiet gTTS pydub
sudo apt-get update -y
sudo apt-get install -y ffmpeg

# Create directories if not exist
mkdir -p client/public/media

# Generate MP3
python3 - <<'EOF'
from gtts import gTTS
tts = gTTS("Hello candidate, this is Aira, how are you?", lang="en")
tts.save("client/public/media/intro.mp3")
EOF

# Convert MP3 to WAV
ffmpeg -y -i client/public/media/intro.mp3 client/public/media/intro.wav

echo "✅ Created client/public/media/intro.wav"

