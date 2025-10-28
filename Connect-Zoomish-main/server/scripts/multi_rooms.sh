ROOM_ID=room-a ROLE=bot DURATION_MIN=5 SIGNALING_URL=https://aira.airahr.ai AUDIO_WAV=/home/ubuntu/aira-zoomish/client/public/media/intro.wav node runner.js > room-a.log 2>&1 &
ROOM_ID=room-b ROLE=bot DURATION_MIN=5 SIGNALING_URL=https://aira.airahr.ai AUDIO_WAV=/home/ubuntu/aira-zoomish/client/public/media/intro.wav node runner.js > room-b.log 2>&1 &
tail -f room-a.log room-b.log

