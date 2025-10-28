# --- base
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl build-essential ufw nginx python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs
sudo ufw allow OpenSSH && sudo ufw allow "Nginx Full" && sudo ufw --force enable

# --- app user + code
sudo adduser --disabled-password --gecos "" aira
sudo usermod -aG sudo aira
sudo -iu aira
git clone https://github.com/aira-hr/aira-connect.git
cd aira-connect
npm install

# --- env (edit the <> values)
cat > .env.dev <<'EOF'
NODE_ENV=development
PORT=3002
PUBLIC_URL=https://connectdev.airahr.ai
BASE_URL=https://connectdev.airahr.ai

# JWT (dev-only secret)
JWT_ISS=aira-dev
JWT_AUD=webrtc
JWT_SECRET=CHANGE_ME_DEV_ONLY
JWT_TTL_MINUTES=180

# Reuse your TURN (update creds if needed)
ICE_SERVERS_JSON=[
  {"urls":["stun:turn.airahr.ai:3478"]},
  {"urls":["turn:turn.airahr.ai:3478?transport=udp"],"username":"devuser","credential":"devpass"},
  {"urls":["turns:turn.airahr.ai:5349?transport=tcp"],"username":"devuser","credential":"devpass"}
]

# Dev DB (separate from prod)
DB_HOST=<dev-db-host>
DB_USER=<dev-db-user>
DB_PASS=<dev-db-pass>
DB_NAME=airadb_dev

# CORS
CORS_ORIGIN=https://connectdev.airahr.ai
EOF

# --- build client
cd client && (npm ci || npm i) && npm run build && cd ..

# --- systemd service
sudo tee /etc/systemd/system/airaconnect.service >/dev/null <<'UNIT'
[Unit]
Description=AIRA CONNECT dev app
After=network.target

[Service]
User=aira
WorkingDirectory=/home/aira/aira-connect
Environment=ENV_FILE=.env.dev
ExecStart=/usr/bin/node server.cjs
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now airaconnect
sudo systemctl status airaconnect --no-pager

