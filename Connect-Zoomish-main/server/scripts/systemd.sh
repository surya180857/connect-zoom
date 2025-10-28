sudo tee /etc/systemd/system/aira.service >/dev/null <<'UNIT'
[Unit]
Description=AIRA app + signaling
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/aira-zoomish
ExecStart=/usr/bin/node core/server.cjs
Environment=PORT=3001
Environment=TURN_SECRET=d5ce87d42b01ca74a3054428d621b5cd8411a3a7287f48910e4d9fd348259a1f
Environment=TURN_HOST=turn.airahr.ai
Environment=TURN_REALM=turn.airahr.ai
Environment=TURN_TTL=3600
Environment=STATUS_TOKEN=x8P5mH2uYhQ0qS1r3v9LwZtB4eN7aK2
Restart=always
User=ubuntu
Group=ubuntu

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now aira
systemctl status aira --no-pager

