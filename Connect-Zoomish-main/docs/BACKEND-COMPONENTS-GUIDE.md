# Backend Components Guide

## Overview

This guide helps identify and understand all backend components in the AIRA project. Unlike the frontend which is organized in the `client/` folder, backend files are located in the project root directory.

## 🔧 Core Backend Services

### Primary Server

- **`server/core/server.cjs`** - Main Express.js + Socket.IO server handling WebRTC signaling
  - HTTP server for serving static files
  - Socket.IO for real-time communication
  - WebRTC signaling coordination
  - **Documentation**: `docs/system/SERVER-DOCUMENTATION.md`

### Bot Automation System

- **`server/bots/runner.cjs`** - Automated recording bot using Playwright

  - Headless browser automation
  - Video recording and screenshots
  - Room joining automation
  - **Documentation**: `docs/system/RUNNER-DOCUMENTATION.md`

- **`server/bots/bot-join.cjs`** - Bot joining functionality
  - Automated participant simulation
  - WebRTC connection handling

### Audio Processing

- **`server/bots/webrtc-audio-monitor.cjs`** - Audio monitoring and processing
  - Real-time audio analysis
  - Audio quality monitoring
  - Stream processing

### Background Jobs

- **`server/core/job-consumer.js`** - Background job processing
  - Asynchronous task handling
  - Queue management
  - Background operations

## ⚙️ Configuration & Deployment

### Process Management

- **`ecosystem.config.js`** - PM2 process manager configuration
  - Production deployment settings
  - Process monitoring
  - Auto-restart configuration

### Queue Management

- **`job-consumer.js`** - Background job processing
  - Asynchronous task handling
  - Queue management
  - Background operations

## 🚀 Deployment Scripts

### Shell Scripts

- **`run_bot.sh`** - Bot execution script
- **`run_bot1.sh`** - Alternative bot runner
- **`make_intro.sh`** - Introduction media generation
- **`multi_rooms.sh`** - Multi-room testing automation
- **`systemd.sh`** - System service configuration

## 📋 Package Management

### Dependencies

- **`package.json`** - Backend dependencies and scripts

  - Node.js dependencies
  - NPM scripts for backend operations
  - Production dependencies

- **`package-lock.json`** - Dependency version lock file

## 🧪 Testing & Development

### Test Files

- **`room.html`** - Simple bot testing interface
  - Manual testing environment
  - Bot behavior verification
  - **Documentation**: `docs/components/ROOM-HTML-DOCUMENTATION.md`

### Legacy Files

- **`server.cjs1`** - Previous server version (backup)

### Error Logs

- **`webrtc-room-3.err`** - Error log file

## 📁 Directory Structure Summary

```
📦 AIRA Project Root
├── 🖥️  BACKEND (server/)
│   ├── core/
│   │   ├── server.cjs          # Main Express + Socket.IO server
│   │   ├── job-consumer.js     # Background job processing
│   │   └── server.cjs1         # Legacy server backup
│   ├── bots/
│   │   ├── runner.cjs          # Recording bot automation
│   │   ├── bot-join.cjs        # Bot joining functionality
│   │   └── webrtc-audio-monitor.cjs # Audio processing
│   ├── config/
│   │   └── ecosystem.config.js # PM2 process management
│   ├── scripts/
│   │   ├── run_bot.sh          # Bot execution scripts
│   │   ├── make_intro.sh       # Media generation
│   │   ├── multi_rooms.sh      # Multi-room testing
│   │   └── systemd.sh          # System service setup
│   ├── testing/
│   │   └── room.html           # Bot testing interface
│   └── package.json            # Backend dependencies
│
├── 🎨 FRONTEND (client/)
│   ├── src/                    # React components
│   ├── public/                 # Static assets
│   └── package.json            # Frontend dependencies
│
└── 📚 DOCUMENTATION (docs/)
    ├── components/             # Frontend documentation
    ├── system/                 # Backend documentation
    └── templates/              # Documentation templates
```

## 🔍 Quick Identification Guide

### Backend Files (.cjs extension)

- `*.cjs` files are CommonJS Node.js backend modules
- Located in project root
- Handle server-side logic, automation, and processing

### Frontend Files

- Located in `client/` directory
- React components (`.jsx` files)
- HTML entry points
- CSS styling

### Configuration Files

- `ecosystem.config.js` - Production deployment
- `package.json` - Backend dependencies
- `*.sh` - Shell scripts for automation

### Testing Files

- `room.html` - Manual testing interface
- `*.err` - Error log files

## 📚 Related Documentation

- **Server Architecture**: `docs/system/SERVER-DOCUMENTATION.md`
- **Bot System**: `docs/system/RUNNER-DOCUMENTATION.md`
- **Frontend Components**: `docs/components/`
- **Project Overview**: `docs/README.md`

---

_This guide helps distinguish backend components from frontend files, providing clear identification for developers working with the AIRA codebase._
