# 📚 File Documentation Template for Beginners

Use this template to document every file in the AIRA project. Copy and paste this structure into each file as comments.

## 🎯 **For JavaScript/Node.js Files (.js, .cjs, .jsx)**

```javascript
/**
 * 🎯 FILE PURPOSE: [What this file does in one sentence]
 * 📍 LOCATION: [Where this fits in the project structure]
 * 🔗 DEPENDENCIES: [What other files/libraries this needs]
 * 📤 EXPORTS: [What this file provides to other files]
 * 📥 IMPORTS: [What this file gets from other files]
 * 🎮 USAGE: [How to use/call this file]
 * 🐛 COMMON ISSUES: [Known problems and solutions]
 * 👤 BEGINNER NOTES: [Extra explanations for new developers]
 *
 * 📖 WHAT THIS FILE DOES:
 * 1. [Step by step breakdown]
 * 2. [Of what happens when this file runs]
 * 3. [Use numbered lists for clarity]
 *
 * 🔍 KEY CONCEPTS FOR BEGINNERS:
 * - [Concept 1]: [Simple explanation]
 * - [Concept 2]: [Simple explanation]
 * - [API/Library name]: [What it does]
 */

// 🚀 SECTION 1: [What this section does]
// BEGINNER: [Explain complex parts in simple terms]

// 🔄 SECTION 2: [What this section does]
// WHY: [Explain why this code is needed]
```

## 🎯 **For HTML Files (.html)**

```html
<!--
🎯 FILE PURPOSE: [What this file does]
📍 LOCATION: [Where this fits in the project]
🔗 DEPENDENCIES: [CSS, JS files this needs]
📤 EXPORTS: [What this provides]
📥 IMPORTS: [What this includes]
🎮 USAGE: [How users access this]
🐛 COMMON ISSUES: [Known problems]
👤 BEGINNER NOTES: [Extra explanations]

📖 WHAT THIS FILE DOES:
1. [Step by step breakdown]
2. [Of the HTML structure]
3. [And what each part does]

🔍 KEY CONCEPTS FOR BEGINNERS:
- [HTML concept]: [Simple explanation]
- [CSS concept]: [Simple explanation]
- [JavaScript concept]: [Simple explanation]
-->

<!-- 📦 SECTION NAME: [What this HTML section does] -->
<!-- BEGINNER: [Explain HTML structure in simple terms] -->
```

## 🎯 **For CSS Files (.css)**

```css
/**
 * 🎯 FILE PURPOSE: [What styling this provides]
 * 📍 LOCATION: [Where this fits in styling]
 * 🔗 DEPENDENCIES: [Other CSS files or frameworks]
 * 📤 EXPORTS: [CSS classes/styles available]
 * 🎮 USAGE: [How to apply these styles]
 * 🐛 COMMON ISSUES: [Browser compatibility, etc.]
 * 👤 BEGINNER NOTES: [CSS concepts explained]
 */

/* 🎨 SECTION: [What these styles do] */
/* BEGINNER: [Explain CSS properties in simple terms] */
```

## 🎯 **For Configuration Files (.json, .config.js)**

```javascript
/**
 * 🎯 FILE PURPOSE: [What this configures]
 * 📍 LOCATION: [Root, build tools, etc.]
 * 🔗 DEPENDENCIES: [Tools that use this config]
 * 🎮 USAGE: [When this config is used]
 * 🐛 COMMON ISSUES: [Common config problems]
 * 👤 BEGINNER NOTES: [Explain config concepts]
 *
 * 📖 CONFIGURATION SECTIONS:
 * - [Section name]: [What it configures]
 * - [Section name]: [What it configures]
 */
```

## 📋 **Documentation Checklist for Each File**

When documenting a file, make sure to cover:

- [ ] **Purpose**: What does this file do?
- [ ] **Location**: Where does it fit in the project?
- [ ] **Dependencies**: What does it need to work?
- [ ] **Exports**: What does it provide to others?
- [ ] **Usage**: How do you use it?
- [ ] **Common Issues**: What goes wrong?
- [ ] **Beginner Notes**: Complex concepts explained simply
- [ ] **Step-by-step**: Break down the process
- [ ] **Key Concepts**: Technical terms explained

## 🎯 **Example: How to Document server.cjs**

```javascript
/**
 * 🎯 FILE PURPOSE: Main backend server handling HTTP requests and WebSocket connections
 * 📍 LOCATION: Root directory - this is the heart of the AIRA platform
 * 🔗 DEPENDENCIES: Express.js, Socket.IO, crypto (for TURN credentials)
 * 📤 EXPORTS: HTTP server on port 3001, WebSocket signaling, TURN credentials
 * 📥 IMPORTS: None (this is the main entry point)
 * 🎮 USAGE: Run with "npm start" or "node server.cjs"
 * 🐛 COMMON ISSUES: Port 3001 already in use, missing TURN_SECRET environment variable
 * 👤 BEGINNER NOTES: This is like the "brain" of the video platform - it coordinates everything
 *
 * 📖 WHAT THIS FILE DOES:
 * 1. Sets up HTTP server to serve the frontend website
 * 2. Creates WebSocket server for real-time communication
 * 3. Provides TURN server credentials for WebRTC connections
 * 4. Manages room state and participant tracking
 * 5. Relays video call signaling between participants
 *
 * 🔍 KEY CONCEPTS FOR BEGINNERS:
 * - Express.js: Framework for creating web servers in Node.js
 * - Socket.IO: Library for real-time communication between browser and server
 * - WebRTC: Technology that enables video calls directly between browsers
 * - TURN/STUN: Special servers that help establish video connections
 * - HMAC-SHA1: Security algorithm for generating time-limited credentials
 */
```

## 🎯 **Recommended Documentation Order**

Document files in this order for best learning experience:

### **1. Core Infrastructure**

1. `package.json` - Project dependencies and scripts
2. `server.cjs` - Main backend server
3. `client/index.html` - Frontend entry point

### **2. Frontend Application**

4. `client/src/main.jsx` - React app initialization
5. `client/src/App.jsx` - Main React component
6. `client/src/styles.css` - Styling

### **3. Automation/Bots**

7. `runner.cjs` - Recording bot
8. `bot-join.cjs` - Simple joining bot
9. `webrtc-audio-monitor.cjs` - Audio monitoring bot

### **4. Configuration/Scripts**

10. `ecosystem.config.js` - PM2 process management
11. `systemd.sh` - System service installation
12. `run_bot.sh` - Bot execution scripts

## 💡 **Tips for Beginner-Friendly Documentation**

### **Use Simple Language**

- ❌ "Asynchronous WebRTC peer connection establishment via ICE negotiation"
- ✅ "Setting up video call connection between two browsers"

### **Explain "Why" Not Just "What"**

- ❌ "This function creates an RTCPeerConnection"
- ✅ "This function creates a video call connection. WHY: Browsers need a special object to handle video calls between different computers"

### **Use Analogies**

- "WebSocket is like a telephone line that stays open between browser and server"
- "TURN server is like a post office that helps deliver video when direct connection fails"

### **Break Down Complex Functions**

```javascript
// 🎯 FUNCTION: setupWebRTCConnection()
// WHY: Browsers need specific steps to establish video calls
// STEPS:
//   1. Create connection object (like dialing a phone)
//   2. Add local video/audio (like speaking into the phone)
//   3. Exchange connection info with other person (like confirming the call)
//   4. Establish direct connection (like the call connecting)
```

This template ensures every file is documented consistently and beginner-friendly!
