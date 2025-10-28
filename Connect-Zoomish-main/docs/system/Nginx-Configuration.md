<!-- cat > /home/ubuntu/webrtc-infrastructure-documentation.md << 'EOF' -->

# WebRTC Infrastructure Documentation

## Overview

This document provides a comprehensive analysis of the WebRTC infrastructure deployed on this Ubuntu VM, including signaling server configuration, Nginx reverse proxy setup, and integration with external STUN/TURN services.

**Server Details:**

- **OS**: Ubuntu Linux
- **Domain**: aira.airahr.ai
- **Main Service**: AIRA WebRTC Signaling Server
- **Architecture**: Signaling + External TURN/STUN

## 🏗 Architecture Overview

```
┌─────────────────┐    HTTPS/WSS (443)    ┌─────────────────┐    HTTP/WS (3001)    ┌─────────────────────┐
│                 │ ──────────────────────→│                 │ ─────────────────────→│                     │
│  Client Browser │                        │  Nginx Proxy    │                       │  Node.js Signaling │
│                 │←────────────────────── │                 │←───────────────────── │  Server             │
└─────────────────┘                        └─────────────────┘                       └─────────────────────┘
                                                                                                │
                                                                                                │ REST API
                                                                                                ▼
┌──────────────────┐    UDP/TCP (3478)     ┌─────────────────────────────────────────────────────────────────┐
│                  │ ──────────────────────→│  External TURN Server (turn.airahr.ai)                         │
│  WebRTC Clients  │                        │  + Google STUN (stun.l.google.com:19302)                      │
│                  │←────────────────────── │                                                                 │
└──────────────────┘                        └─────────────────────────────────────────────────────────────────┘
```

## 📋 Services Inventory

### ✅ Active Services

#### 1. AIRA Signaling Server

- **Service Name**: `aira.service` (systemd)
- **Status**: Active (running since Aug 23, 16+ hours uptime)
- **Process**: Node.js (`/usr/bin/node server.cjs`)
- **Port**: 3001 (internal)
- **Working Directory**: `/home/ubuntu/aira-zoomish`
- **User**: `ubuntu:ubuntu`

#### 2. Nginx Reverse Proxy

- **Status**: Active and running
- **Ports**: 80 (HTTP), 443 (HTTPS)
- **Configuration**: `/etc/nginx/sites-enabled/aira`
- **SSL**: Let's Encrypt certificates

### ❌ Services NOT Running Locally

- **TURN Server**: Uses external `turn.airahr.ai:3478`
- **STUN Server**: Uses Google's `stun.l.google.com:19302`
- **Media Servers**: No Janus, Kurento, or similar media servers

## 🔧 Configuration Details

### AIRA Service Configuration

**File**: `/etc/systemd/system/aira.service`

```ini
[Unit]
Description=AIRA app + signaling
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/aira-zoomish
ExecStart=/usr/bin/node server.cjs
Environment=PORT=3001
Environment=TURN_SECRET=d5ce87d42b01ca74a3054428d621b5cd8411a3a7287f48910e4d9fd348259a1f
Environment=TURN_HOST=turn.airahr.ai
Environment=TURN_REALM=turn.airahr.ai
Environment=TURN_TTL=3600
Restart=always
User=ubuntu
Group=ubuntu

[Install]
WantedBy=multi-user.target
```

**Key Environment Variables:**

- `PORT=3001` - Signaling server port
- `TURN_SECRET` - Shared secret for TURN credential generation
- `TURN_HOST=turn.airahr.ai` - External TURN server hostname
- `TURN_REALM=turn.airahr.ai` - TURN server realm
- `TURN_TTL=3600` - Credential time-to-live (1 hour)

### Node.js Signaling Server

**Main File**: `/home/ubuntu/aira-zoomish/server.cjs`

**Key Features:**

- **WebSocket Signaling**: Socket.IO based WebRTC signaling
- **TURN Credentials API**: REST endpoint at `/turn-credentials`
- **Room Management**: Multi-room support with participant tracking
- **Chat Integration**: Real-time messaging
- **Health Check**: `/healthz` endpoint

**TURN Credentials Endpoint** (`/turn-credentials`):

```javascript
app.get("/turn-credentials", (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TURN_TTL;
  const username = `${exp}:browser`;
  const credential = crypto
    .createHmac("sha1", TURN_SECRET)
    .update(username)
    .digest("base64");
  res.json({
    username,
    credential,
    ttl: TURN_TTL,
    realm: TURN_REALM,
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: [
          `turn:${TURN_HOST}:3478?transport=udp`,
          `turn:${TURN_HOST}:3478?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
  });
});
```

**Example Response:**

```json
{
  "username": "1756040403:browser",
  "credential": "RN8jk21COdwm7IT2jcrflmWjY/k=",
  "ttl": 3600,
  "realm": "turn.airahr.ai",
  "iceServers": [
    {
      "urls": "stun:stun.l.google.com:19302"
    },
    {
      "urls": [
        "turn:turn.airahr.ai:3478?transport=udp",
        "turn:turn.airahr.ai:3478?transport=tcp"
      ],
      "username": "1756040403:browser",
      "credential": "RN8jk21COdwm7IT2jcrflmWjY/k="
    }
  ]
}
```

### Nginx Configuration

#### Main Configuration (`/etc/nginx/nginx.conf`)

```nginx
user www-data;
worker_processes auto;
pid /run/nginx.pid;
error_log /var/log/nginx/error.log;

events {
    worker_connections 768;
}

http {
    # Basic Settings
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;

    # SSL Settings
    ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Logging & Compression
    access_log /var/log/nginx/access.log;
    gzip on;

    include /etc/nginx/mime.types;
    include /etc/nginx/sites-enabled/*;
}
```

#### Site Configuration (`/etc/nginx/sites-enabled/aira`)

```nginx
# HTTP: redirect to HTTPS (keep ACME path)
server {
  listen 80;
  server_name aira.airahr.ai;

  location ^~ /.well-known/acme-challenge/ {
    root /var/www/html;
  }
  location / {
    return 301 https://$host$request_uri;
  }
}

# HTTPS: ALL paths -> :3001 (Node serves SPA + /socket.io + /turn-credentials)
server {
  listen 443 ssl http2;
  server_name aira.airahr.ai;

  # Let's Encrypt SSL Certificates
  ssl_certificate     /etc/letsencrypt/live/aira.airahr.ai/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/aira.airahr.ai/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  client_max_body_size 200M;

  # WebSocket upgrade for Socket.IO
  location /socket.io/ {
    proxy_pass http://127.0.0.1:3001/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
  }

  # Everything else (SPA, /turn-credentials, assets)
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

#### SSL Configuration (`/etc/letsencrypt/options-ssl-nginx.conf`)

```nginx
# Mozilla SSL Configuration
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;

ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
```

## 🌐 Network Configuration

### Port Mapping

| Port  | Service  | Protocol | Description                  |
| ----- | -------- | -------- | ---------------------------- |
| 80    | Nginx    | HTTP     | Redirect to HTTPS            |
| 443   | Nginx    | HTTPS    | Main web interface           |
| 3001  | Node.js  | HTTP/WS  | Internal signaling server    |
| 3478  | External | UDP/TCP  | TURN server (turn.airahr.ai) |
| 19302 | External | UDP      | Google STUN server           |

### DNS Configuration

```
aira.airahr.ai → This VM (nginx proxy)
turn.airahr.ai → 98.86.254.138 (external TURN server)
```

## 🔐 Security Configuration

### SSL/TLS Setup

- **Certificate Authority**: Let's Encrypt
- **Domain**: aira.airahr.ai
- **Protocols**: TLS 1.2, TLS 1.3
- **Cipher Suites**: Modern ECDHE and DHE suites
- **HSTS**: Ready for implementation

### TURN Authentication

- **Method**: HMAC-SHA1 with shared secret
- **TTL**: 3600 seconds (1 hour)
- **Username Format**: `{timestamp}:browser`
- **Dynamic**: Credentials generated on-demand

## 📊 Application Structure

### Project Directory (`/home/ubuntu/aira-zoomish/`)

```
aira-zoomish/
├── server.cjs              # Main signaling server
├── runner.cjs              # Bot/automation scripts
├── client/                 # Frontend SPA
├── package.json            # Node.js dependencies
├── bot-join.cjs           # Bot joining functionality
├── webrtc-audio-monitor.cjs # Audio monitoring
└── *.sh                   # Shell scripts for deployment
```

### Dependencies (`package.json`)

```json
{
  "dependencies": {
    "express": "^4.21.2",
    "puppeteer": "^24.17.0",
    "socket.io": "^4.8.1"
  },
  "devDependencies": {
    "playwright": "^1.55.0"
  }
}
```

## 🚀 Deployment Commands

### Service Management

```bash
# Check service status
sudo systemctl status aira.service

# Start/stop/restart service
sudo systemctl start aira.service
sudo systemctl stop aira.service
sudo systemctl restart aira.service

# Enable/disable autostart
sudo systemctl enable aira.service
sudo systemctl disable aira.service

# View logs
sudo journalctl -u aira.service -f
```

### Nginx Management

```bash
# Test configuration
sudo nginx -t

# Reload configuration
sudo systemctl reload nginx

# Restart nginx
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### SSL Certificate Management

```bash
# Renew certificates
sudo certbot renew

# Check certificate status
sudo certbot certificates

# Test automatic renewal
sudo certbot renew --dry-run
```

## 🔍 Monitoring & Troubleshooting

### Health Checks

```bash
# Application health
curl http://localhost:3001/healthz

# TURN credentials test
curl http://localhost:3001/turn-credentials

# Service status
sudo systemctl status aira.service nginx

# Port listening
ss -tulpn | grep -E "(80|443|3001)"
```

### Log Files

```bash
# Application logs
sudo journalctl -u aira.service -f

# Nginx access logs
sudo tail -f /var/log/nginx/access.log

# Nginx error logs
sudo tail -f /var/log/nginx/error.log
```

### Common Issues

1. **Service won't start**: Check TURN_SECRET environment variable
2. **SSL errors**: Verify Let's Encrypt certificates exist and are readable
3. **WebSocket connection fails**: Check nginx proxy headers and timeouts
4. **TURN credentials invalid**: Verify shared secret matches external server

## 📈 Performance Optimization

### Nginx Optimizations

- HTTP/2 enabled for better performance
- Gzip compression enabled
- Long timeout for WebSocket connections (3600s)
- Large file upload support (200MB)

### Node.js Optimizations

- Process management via systemd
- Automatic restart on failure
- Memory and CPU monitoring available

## 🔗 External Dependencies

### TURN Server

- **Hostname**: turn.airahr.ai
- **IP**: 98.86.254.138
- **Ports**: 3478 (UDP/TCP)
- **Authentication**: HMAC-SHA1 with shared secret

### STUN Server

- **Provider**: Google
- **Endpoint**: stun.l.google.com:19302
- **Protocol**: UDP

## 📝 Maintenance Tasks

### Regular Maintenance

1. Monitor SSL certificate expiration
2. Update Node.js dependencies
3. Check TURN server availability
4. Review application logs for errors
5. Monitor disk space and memory usage

### Security Updates

1. Keep Ubuntu packages updated
2. Update Node.js and npm packages
3. Review and rotate TURN shared secret
4. Monitor SSL/TLS configuration for new recommendations

---

**Document Generated**: 2025-08-24  
**Server**: Ubuntu VM running AIRA WebRTC Signaling Server  
**Domain**: aira.airahr.ai  
**Last Updated**: Current system status as of document generation
EOF
