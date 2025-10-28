# AIRA Video Interview Platform

## 🚀 Overview

AIRA is a modern video interview platform (like Zoom, but for interviews) with:

- **Frontend**: React-based web UI (`client/`)
- **Backend**: Node.js/Express/Socket.IO server and automation bots (`server/`)
- **Automation**: Recording bots, test bots, and scripts
- **Documentation**: Comprehensive guides in `docs/`

## 📚 Documentation

**All technical, onboarding, and usage documentation is in [`docs/README.md`](./docs/README.md).**

- For setup, deployment, and architecture, start there!

## 🗂️ Project Structure (2025)

```
aira-zoomish/
├── client/         # Frontend React app
├── server/         # Backend (Node.js, bots, scripts, config)
│   ├── core/       # Main server and job consumer
│   ├── bots/       # Recording and automation bots
│   ├── config/     # PM2 and other configs
│   ├── scripts/    # Shell scripts for automation/deployment
│   ├── testing/    # Test interfaces (e.g. room.html)
│   └── package.json
├── docs/           # All documentation (see docs/README.md)
├── package.json    # Root project config
└── ...             # Other files (logs, recordings, etc.)
```

## 📁 File-by-File Overview

Below is a detailed tree of the project with a one-line description for each file and folder:

```
aira-zoomish/
├── .DS_Store                  # macOS system file (can be ignored)
├── .git/                      # Git version control data
├── .gitignore                 # Git ignore rules
├── APP-COMPONENT-DOCUMENTATION.md # Standalone doc for main React component
├── DOCUMENTATION-PROGRESS.md  # Tracks documentation completion
├── DOCUMENTATION-TEMPLATE.md  # Template for documenting new files
├── INDEX-HTML-DOCUMENTATION.md # Standalone doc for frontend HTML entry
├── MAIN-JSX-DOCUMENTATION.md  # Standalone doc for React entry point
├── README.md                  # Project overview and structure (this file)
├── ROOM-HTML-DOCUMENTATION.md # Standalone doc for bot test interface
├── RUNNER-DOCUMENTATION.md    # Standalone doc for recording bot
├── SERVER-DOCUMENTATION.md    # Standalone doc for backend server
├── client/                    # Frontend React app and assets
│   ├── dist/                  # Production build output
│   │   ├── assets/            # Bundled JS/CSS assets
│   │   ├── index.html         # Built HTML entry
│   │   └── media/             # Built media assets
│   ├── index.html             # Main HTML entry for frontend
│   ├── node_modules/          # Frontend dependencies (auto-managed)
│   ├── package-lock.json      # Frontend dependency lock file
│   ├── package.json           # Frontend dependencies and scripts
│   ├── public/                # Static assets (media, intro.wav, etc.)
│   │   └── media/             # Audio files for intro, etc.
│   ├── src/                   # React source code
│   │   ├── App.jsx            # Main React component
│   │   ├── App.jsx1           # (Backup/alt) React component
│   │   ├── main.jsx           # React entry point
│   │   └── styles.css         # Frontend styles
│   └── vite.config.js         # Frontend build configuration
├── docs/                      # All documentation and guides
│   ├── BACKEND-COMPONENTS-GUIDE.md # Guide to backend files/components
│   ├── DOCUMENTATION-PROGRESS.md   # Documentation progress tracker
│   ├── README.md                   # Main documentation entry point
│   ├── TABLE-OF-CONTENTS.md        # Docs table of contents
│   ├── components/                 # Frontend component documentation
│   │   ├── APP-COMPONENT-DOCUMENTATION.md
│   │   ├── INDEX-HTML-DOCUMENTATION.md
│   │   ├── MAIN-JSX-DOCUMENTATION.md
│   │   └── ROOM-HTML-DOCUMENTATION.md
│   ├── system/                     # Backend/system documentation
│   │   ├── AWS-WebRTC.ini          # Example AWS TURN config
│   │   ├── Nginx-Configuration.md  # Example Nginx config
│   │   ├── RUNNER-DOCUMENTATION.md # Recording bot doc
│   │   ├── RUN_BOT-SCRIPTS-DOCUMENTATION.md # run_bot.sh doc
│   │   └── SERVER-DOCUMENTATION.md # Backend server doc
│   └── templates/                  # Documentation templates
│       └── DOCUMENTATION-TEMPLATE.md
├── interview_reports/          # Logs and reports from interview/test runs
│   └── dryrun_webrtc_bot_test-room.log # Example test log
├── node_modules/               # Project dependencies (auto-managed)
├── package-lock.json           # Dependency lock file
├── package.json                # Root project config (scripts, shared deps)
├── recordings/                 # Video/audio recordings from bots
│   └── ...                     # Folders for each recording session/room
├── room.html                   # (Legacy) test interface for bots
├── runner.cjs                  # (Legacy) bot runner script
├── server/                     # Backend (Node.js, bots, scripts, config)
│   ├── bots/                   # Automation and bot systems
│   │   ├── bot-join.cjs        # Bot for joining rooms automatically
│   │   ├── runner.cjs          # Recording bot automation logic
│   │   └── webrtc-audio-monitor.cjs # Audio monitoring/analysis bot
│   ├── config/                 # Backend configs
│   │   └── ecosystem.config.js # PM2 process manager configuration
│   ├── core/                   # Main backend services
│   │   ├── job-consumer.js     # Background job processor
│   │   ├── server.cjs          # Main Express/Socket.IO server
│   │   └── server.cjs1         # Legacy/backup server version
│   ├── package.json            # Backend dependencies and scripts
│   ├── scripts/                # Shell scripts for automation/deployment
│   │   ├── make_intro.sh       # Script to generate intro media
│   │   ├── multi_rooms.sh      # Script for multi-room bot testing
│   │   ├── run_bot.sh          # Shell script to launch recording bot
│   │   ├── run_bot1.sh         # Alternate bot launch script
│   │   └── systemd.sh          # Systemd service setup script
│   ├── testing/                # Test interfaces
│   │   └── room.html           # Test interface for bots
├── server.cjs                  # (Legacy) main server script
├── webrtc-room-3.err           # Error log file
```
