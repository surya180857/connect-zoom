# 📚 AIRA Documentation

Welcome to the comprehensive documentation for the AIRA Video Interview Platform. This documentation covers every aspect of the system from basic setup to advanced deployment.

## 📋 Table of Contents

### 🏗️ System Architecture

- [� Backend Components Guide](./BACKEND-COMPONENTS-GUIDE.md) - **Essential guide to identify all backend files and components**
- [�🖥️ Backend Server](./system/SERVER-DOCUMENTATION.md) - Express.js server with Socket.IO and WebRTC signaling
- [🤖 Recording Bot](./system/RUNNER-DOCUMENTATION.md) - Automated recording and screenshot capture system

### 🧩 Frontend Components

- [📄 HTML Entry Point](./components/INDEX-HTML-DOCUMENTATION.md) - Client application bootstrap with media pre-capture
- [⚡ React Bootstrap](./components/MAIN-JSX-DOCUMENTATION.md) - React 18 application initialization
- [🎬 Main App Component](./components/APP-COMPONENT-DOCUMENTATION.md) - Core video calling interface
- [🧪 Testing Interface](./components/ROOM-HTML-DOCUMENTATION.md) - Simple bot testing environment

### 📖 Documentation Resources

- [📝 Progress Tracker](./DOCUMENTATION-PROGRESS.md) - Current documentation status
- [📋 Documentation Template](./templates/DOCUMENTATION-TEMPLATE.md) - Template for documenting new files

## 🚀 Quick Start

### For Developers

1. **Project Setup**:

   ```bash
   # Install all dependencies (client + server)
   npm run install:all

   # Or install separately
   npm run build:client    # Install client dependencies
   npm run build:server    # Install server dependencies
   ```

2. **Backend Setup**:

   ```bash
   # Start main server
   npm start              # or cd server && npm start
   npm run dev           # Development mode
   ```

   - Read [Backend Components Guide](./BACKEND-COMPONENTS-GUIDE.md) for file organization
   - Study [Server Documentation](./system/SERVER-DOCUMENTATION.md) for technical details

3. **Frontend Setup**:

   ```bash
   # Client is served by the backend server
   # Frontend files are in client/ directory
   ```

   - Read [HTML Entry Point](./components/INDEX-HTML-DOCUMENTATION.md) and [React Bootstrap](./components/MAIN-JSX-DOCUMENTATION.md)

4. **Main Application**: Understand the [Main App Component](./components/APP-COMPONENT-DOCUMENTATION.md)

### For Bot Developers

1. **Testing Environment**:

   ```bash
   # Access bot testing interface
   # Start server first, then navigate to /room.html
   npm start
   ```

   - Begin with [Testing Interface](./components/ROOM-HTML-DOCUMENTATION.md)

2. **Recording System**:

   ```bash
   # Run recording bot
   npm run bot

   # Run bot joining functionality
   npm run join-bot

   # Run audio monitoring
   npm run audio-monitor
   ```

   - Study [Recording Bot](./system/RUNNER-DOCUMENTATION.md)

3. **Integration**: Use examples from both documents for automation

### For DevOps/Deployment

1. **Production Deployment**:

   ```bash
   # Production setup with PM2
   cd server
   npm run pm2:start     # Start with PM2
   npm run pm2:stop      # Stop PM2 processes
   npm run pm2:restart   # Restart PM2 processes
   ```

2. **Development Scripts**:

   ```bash
   # Backend development
   cd server
   npm run dev           # Development server
   npm run jobs          # Background job consumer

   # Shell scripts (from server/scripts/)
   ./scripts/run_bot.sh      # Bot execution
   ./scripts/multi_rooms.sh  # Multi-room testing
   ./scripts/make_intro.sh   # Media generation
   ./scripts/systemd.sh      # System service setup
   ```

3. **Server Configuration**: [Backend Server](./system/SERVER-DOCUMENTATION.md) - Production deployment section
4. **Performance**: Check performance metrics in each component documentation
5. **Monitoring**: Server health check and logging configurations

## 🎯 Documentation Features

Each documentation file includes:

- **📋 Comprehensive Overview** - What the component does and why
- **🏗️ Technical Architecture** - How components interact with each other
- **📝 Complete Code Analysis** - Line-by-line explanations with comments
- **🎮 Usage Examples** - Real-world implementation scenarios
- **🔧 Configuration Options** - Environment variables and settings
- **💡 Use Cases** - Business applications and scenarios
- **🚨 Troubleshooting** - Common issues and solutions
- **📊 Performance Metrics** - File sizes, load times, scaling information
- **🔒 Security Considerations** - Best practices and safeguards

## 🎨 Documentation Style

Our documentation follows these principles:

- **🎯 Beginner-Friendly** - Clear explanations with real-world analogies
- **🧑‍💻 Developer-Focused** - Technical implementation details for experts
- **📊 Production-Ready** - Deployment and scaling information
- **🔍 Searchable** - Well-organized with clear headings and structure
- **📱 Complete** - Covers every aspect from basics to advanced features

## 📁 Directory Structure

```
📦 AIRA Project Root
├── 📚 docs/                           # Documentation
│   ├── README.md                      # This file - documentation overview
│   ├── BACKEND-COMPONENTS-GUIDE.md    # Backend file organization guide
│   ├── DOCUMENTATION-PROGRESS.md      # Current documentation status
│   ├── components/                    # Frontend component documentation
│   │   ├── INDEX-HTML-DOCUMENTATION.md    # HTML entry point (client bootstrap)
│   │   ├── MAIN-JSX-DOCUMENTATION.md      # React application initialization
│   │   ├── APP-COMPONENT-DOCUMENTATION.md # Main React video calling component
│   │   └── ROOM-HTML-DOCUMENTATION.md     # Simple bot testing interface
│   ├── system/                       # Backend and system documentation
│   │   ├── SERVER-DOCUMENTATION.md    # Express.js + Socket.IO backend
│   │   └── RUNNER-DOCUMENTATION.md    # Recording bot automation system
│   └── templates/                    # Documentation templates and guides
│       └── DOCUMENTATION-TEMPLATE.md  # Template for documenting new files
├── 🎨 client/                        # Frontend Application
│   ├── src/                          # React components and source code
│   ├── public/                       # Static assets and media files
│   ├── dist/                         # Built frontend assets (generated)
│   ├── package.json                  # Frontend dependencies
│   └── vite.config.js               # Frontend build configuration
├── 🖥️  server/                       # Backend Application
│   ├── core/                         # Core backend services
│   │   ├── server.cjs                # Main Express + Socket.IO server
│   │   ├── job-consumer.js           # Background job processing
│   │   └── server.cjs1               # Legacy server backup
│   ├── bots/                         # Automation and bot systems
│   │   ├── runner.cjs                # Recording bot automation
│   │   ├── bot-join.cjs              # Bot joining functionality
│   │   └── webrtc-audio-monitor.cjs  # Audio processing and monitoring
│   ├── config/                       # Configuration files
│   │   └── ecosystem.config.js       # PM2 process management config
│   ├── scripts/                      # Deployment and automation scripts
│   │   ├── run_bot.sh                # Bot execution scripts
│   │   ├── make_intro.sh             # Media generation scripts
│   │   ├── multi_rooms.sh            # Multi-room testing automation
│   │   └── systemd.sh                # System service setup
│   ├── testing/                      # Testing interfaces and tools
│   │   └── room.html                 # Bot testing interface
│   └── package.json                  # Backend dependencies and scripts
├── package.json                      # Root project configuration
└── README.md                         # Project overview and setup
```

## 🔧 Technology Stack Coverage

### Frontend Technologies

- **React 18** - Modern concurrent rendering and hooks
- **WebRTC** - Peer-to-peer video/audio communication
- **Socket.IO Client** - Real-time bidirectional communication
- **HTML5 Media APIs** - Camera and microphone access
- **CSS3** - Responsive design and animations
- **Vite** - Modern build tool and development server

### Backend Technologies

- **Node.js** - JavaScript runtime environment
- **Express.js** - Web application framework
- **Socket.IO** - Real-time communication server
- **WebRTC Signaling** - Offer/answer/ICE candidate routing
- **TURN Server Integration** - NAT traversal and media relay

### Automation Technologies

- **Playwright** - Browser automation for recording bots
- **Headless Chrome** - Invisible browser for automated recording
- **MediaRecorder API** - Video/audio recording capabilities
- **Canvas API** - Video composition and rendering
- **Web Audio API** - Audio mixing and processing

## �️ What is PM2?

**PM2** is a Production Process Manager for Node.js applications. It acts as a supervisor to keep your backend services running reliably, especially in production.

### 🔧 Key Features of PM2

- **Auto-restart:** Automatically restarts your server if it crashes.
- **Background running:** Keeps your app running even after you log out of the server.
- **Multiple instances:** Can run several copies of your app for better performance.
- **Resource monitoring:** Tracks CPU, memory usage, and performance metrics.
- **Zero-downtime deployments:** Updates your app without stopping service.
- **Log management:** Centralizes and rotates application logs.
- **Cluster mode:** Uses all CPU cores for maximum performance.
- **Startup scripts:** Automatically starts your apps when the server boots.

### 🎯 Why AIRA Uses PM2

AIRA uses PM2 to:

- Run and supervise the recording bots and backend server.
- Ensure bots and services restart automatically if they crash.
- Manage environment variables and configuration for each service.
- Provide reliable, continuous operation for interviews and recordings.

#### Example PM2 Configuration

Located in `server/config/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: "aira-bot",
      script: "../bots/runner.cjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        ROLE: "bot",
        DURATION_MIN: "10",
        SIGNALING_URL: "https://aira.airahr.ai",
        OUT_DIR: "/opt/aira/recordings",
      },
    },
  ],
};
```

### 📋 Common PM2 Commands

```bash
npm run pm2:start      # Start all configured apps
npm run pm2:stop       # Stop all apps
npm run pm2:restart    # Restart all apps

# Direct PM2 commands:
pm2 list               # Show running processes
pm2 logs               # View logs from all apps
pm2 monit              # Real-time monitoring dashboard
```

### 🏢 Real-World Analogy

PM2 is like a 24/7 IT administrator for your Node.js apps:

- If your app crashes, PM2 restarts it immediately.
- If your server reboots, PM2 starts your apps automatically.
- If you update your app, PM2 does it without downtime.
- PM2 keeps detailed logs of everything that happens.

### ⚡ For Your AIRA Project

PM2 ensures:

- Recording bots and backend services run continuously.
- Video interviews are reliable and uninterrupted.
- Automated processes are supervised and restarted if needed.

**Without PM2:** A crashed bot or server would stay down until manually restarted.  
**With PM2:** Everything restarts automatically, ensuring reliability for your interviews and recordings.

## �💡 Common Use Cases

### 📼 Video Interview Platform

- **HR Departments** - Conduct remote interviews with recording

  ```bash
  # Start platform
  npm start
  # Access at http://localhost:3001
  # Enable recording bot: npm run bot
  ```

- **Recruitment Agencies** - Streamline candidate screening process

  ```bash
  # Multi-room testing
  cd server && ./scripts/multi_rooms.sh
  ```

- **Educational Institutions** - Online admissions and assessments

### 🎓 Educational Platform

- **Online Schools** - Virtual classrooms and office hours

  ```bash
  # Start with audio monitoring
  npm start
  npm run audio-monitor
  ```

- **Corporate Training** - Employee development and onboarding
- **Tutoring Services** - One-on-one and group sessions

### 🏢 Business Communication

- **Remote Teams** - Daily standups and team meetings

  ```bash
  # Quick setup for team meetings
  npm run install:all
  npm start
  ```

- **Client Meetings** - Sales demos and support calls
- **Legal Services** - Remote depositions and consultations
  ```bash
  # Production deployment
  cd server
  npm run pm2:start
  ```

## 🚨 Getting Help

### Documentation Issues

- Check [Progress Tracker](./DOCUMENTATION-PROGRESS.md) for completion status
- Use [Documentation Template](./templates/DOCUMENTATION-TEMPLATE.md) for new files
- Look for "🚨 Common Issues" sections in each document

### Technical Support

- **Frontend Issues** - Check component documentation in `components/`
- **Backend Issues** - Reference system documentation in `system/`
- **Bot Integration** - Start with testing interface documentation

### Contributing to Documentation

1. Follow the [Documentation Template](./templates/DOCUMENTATION-TEMPLATE.md)
2. Update [Progress Tracker](./DOCUMENTATION-PROGRESS.md) when adding new docs
3. Maintain the same style and structure as existing documentation
4. Include real-world examples and use cases

### Development Workflow

```bash
# Full development setup
npm run install:all           # Install all dependencies

# Start development
npm run dev                   # Start server in development mode

# Run bots for testing
npm run bot                   # Recording bot
npm run join-bot             # Join automation
npm run audio-monitor        # Audio processing

# Production deployment
cd server
npm run pm2:start            # Start with process manager
```

## 📊 Documentation Statistics

- **Total Files Documented**: 6 core files
- **Documentation Coverage**: 100% of core application
- **Documentation Size**: ~150KB total (comprehensive)
- **Target Audience**: Developers, DevOps, QA, Business stakeholders
- **Maintenance Status**: ✅ Active (updated August 2025)

---

**Last Updated**: August 23, 2025  
**Version**: 1.0  
**Maintainers**: Development Team  
**License**: Same as main project
