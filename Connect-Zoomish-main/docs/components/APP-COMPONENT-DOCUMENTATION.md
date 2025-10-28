# 🎬 App.jsx - Main React Component Documentation

## 📋 Overview

The `App.jsx` file is the **heart of the AIRA video interview application** - a sophisticated React component that handles the entire video calling experience including WebRTC connections, real-time communication, and user interface management.

## 🎯 Main Purpose

This component creates a complete video interview platform that:

- 🎥 Manages video calls between interviewers and candidates
- 🔊 Handles audio/video streams using WebRTC technology
- 💬 Provides real-time chat and communication
- 🎛️ Controls media devices (camera, microphone)
- 📱 Manages user interface and interactions
- 🔗 Connects to backend server via Socket.IO

## 🏗️ Technical Architecture

```
┌─────────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│    React Frontend   │    │   Socket.IO      │    │  Backend Server │
│                     │    │                  │    │                 │
│ • State Management  │◄──►│ • Real-time msgs │◄──►│ • Room mgmt     │
│ • WebRTC handling   │    │ • Event routing  │    │ • User auth     │
│ • UI Components     │    │ • Connection mgmt│    │ • TURN server   │
│ • Media controls    │    │                  │    │ • Persistence   │
└─────────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🧩 Component Structure

### Core State Management

```javascript
// User and Room Information
const [userName, setUserName] = useState(""); // Current user's name
const [roomId, setRoomId] = useState(""); // Current room ID
const [userRole, setUserRole] = useState(""); // User's role (interviewer/candidate)
const [isInRoom, setIsInRoom] = useState(false); // Whether user has joined

// Media Streams and Devices
const [localStream, setLocalStream] = useState(null); // User's camera/mic
const [remoteStreams, setRemoteStreams] = useState({}); // Other participants
const [devices, setDevices] = useState({}); // Available cameras/mics
const [selectedDevices, setSelectedDevices] = useState({}); // Chosen devices

// Connection and Communication
const [socket, setSocket] = useState(null); // Socket.IO connection
const [peers, setPeers] = useState({}); // WebRTC peer connections
const [messages, setMessages] = useState([]); // Chat messages
const [notifications, setNotifications] = useState([]); // System alerts
```

## 🔧 Key Features

### 1. **Media Management** 📹

- **Device Detection**: Automatically finds available cameras and microphones
- **Stream Capture**: Gets user's video/audio with customizable constraints
- **Device Switching**: Allows real-time switching between cameras/mics
- **Media Controls**: Mute/unmute audio, enable/disable video

### 2. **WebRTC Connection Handling** 🌐

- **Peer Connection Setup**: Creates RTCPeerConnection for each participant
- **ICE Candidate Exchange**: Handles network traversal for connections
- **Offer/Answer Protocol**: Manages SDP negotiation for media
- **TURN Server Integration**: Uses TURN servers for NAT traversal

### 3. **Real-time Communication** 💬

- **Socket.IO Integration**: Maintains persistent connection to server
- **Event Handling**: Processes join/leave, offers, answers, ICE candidates
- **Chat System**: Real-time text messaging between participants
- **Presence Management**: Tracks who's online and their status

### 4. **User Interface** 🎨

- **Responsive Design**: Works on desktop and mobile devices
- **Video Grid**: Dynamic layout for multiple participants
- **Control Panel**: Media controls, chat, settings
- **Join/Leave Flow**: Smooth onboarding and exit experience

## 🎮 Component Lifecycle

### Initialization Phase

1. **Mount**: Component loads and initializes state
2. **URL Parsing**: Extracts room/user info from URL parameters
3. **Socket Connection**: Establishes connection to backend server
4. **Device Enumeration**: Discovers available media devices

### Join Room Phase

1. **User Input**: Collects name and role if not provided
2. **Media Access**: Requests camera/microphone permissions
3. **Stream Setup**: Captures local video/audio stream
4. **Room Join**: Sends join request to server via Socket.IO

### Active Call Phase

1. **Peer Discovery**: Receives list of existing participants
2. **Connection Setup**: Creates WebRTC connections to each peer
3. **Media Exchange**: Shares video/audio streams with participants
4. **Real-time Events**: Handles new joins, leaves, messages

### Cleanup Phase

1. **Stream Stopping**: Closes camera/microphone access
2. **Connection Teardown**: Properly closes WebRTC connections
3. **Socket Disconnect**: Cleanly disconnects from server
4. **State Reset**: Clears all component state

## 💡 Real-World Use Cases

### 📼 Job Interviews

- **Interviewer View**: See candidate's video, ask questions, take notes
- **Candidate View**: Professional video quality, screen sharing
- **Recording Integration**: Works with recording bots for later review
- **Multi-interviewer**: Support for panel interviews

### 🎓 Online Meetings

- **Team Standups**: Quick video check-ins with multiple participants
- **Client Presentations**: Professional video calls with screen sharing
- **Training Sessions**: Instructor-led sessions with Q&A
- **Support Calls**: Technical support with video assistance

### 🏢 Remote Collaboration

- **Code Reviews**: Developer collaboration with screen sharing
- **Design Reviews**: Visual feedback sessions
- **Sales Demos**: Product demonstrations to prospects
- **Customer Success**: Check-ins and support calls

## 🔧 Configuration Options

### Media Constraints

```javascript
const videoConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
};

const audioConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};
```

### WebRTC Configuration

```javascript
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:turn.airahr.ai:3478",
      username: "user",
      credential: "pass",
    },
  ],
};
```

### Socket.IO Events

```javascript
// Outgoing Events
socket.emit("join-room", { roomId, userName, userRole });
socket.emit("offer", { targetUserId, offer, roomId });
socket.emit("answer", { targetUserId, answer, roomId });
socket.emit("ice-candidate", { targetUserId, candidate, roomId });
socket.emit("chat-message", { message, roomId });

// Incoming Events
socket.on("user-joined", handleUserJoined);
socket.on("user-left", handleUserLeft);
socket.on("offer", handleOffer);
socket.on("answer", handleAnswer);
socket.on("ice-candidate", handleIceCandidate);
socket.on("chat-message", handleChatMessage);
```

## 🛠️ Technical Implementation

### State Management Pattern

- **React Hooks**: Uses useState and useEffect for state management
- **Immutable Updates**: Ensures proper React re-renders
- **Cleanup Effects**: Proper cleanup to prevent memory leaks
- **Error Boundaries**: Graceful error handling

### WebRTC Implementation

- **Modern APIs**: Uses latest WebRTC specifications
- **Connection Pooling**: Efficient management of multiple peer connections
- **Fallback Handling**: Graceful degradation for older browsers
- **Security**: Secure media transmission with encryption

### Performance Optimizations

- **Lazy Loading**: Components load only when needed
- **Memoization**: Prevents unnecessary re-renders
- **Stream Management**: Efficient handling of video streams
- **Event Debouncing**: Optimizes frequent user interactions

## 🎨 User Interface Components

### Video Grid Layout

```javascript
const VideoGrid = () => (
  <div className="video-grid">
    <div className="local-video">
      <video ref={localVideoRef} autoPlay muted />
      <div className="user-label">{userName} (You)</div>
    </div>
    {Object.entries(remoteStreams).map(([userId, stream]) => (
      <div key={userId} className="remote-video">
        <video autoPlay />
        <div className="user-label">{stream.userName}</div>
      </div>
    ))}
  </div>
);
```

### Control Panel

```javascript
const ControlPanel = () => (
  <div className="controls">
    <button onClick={toggleAudio}>{audioEnabled ? "🎤" : "🔇"}</button>
    <button onClick={toggleVideo}>{videoEnabled ? "📹" : "📷"}</button>
    <button onClick={leaveRoom}>📞 End Call</button>
  </div>
);
```

### Chat Interface

```javascript
const ChatPanel = () => (
  <div className="chat">
    <div className="messages">
      {messages.map((msg) => (
        <div key={msg.id} className="message">
          <strong>{msg.userName}:</strong> {msg.text}
        </div>
      ))}
    </div>
    <input
      type="text"
      onKeyPress={handleSendMessage}
      placeholder="Type a message..."
    />
  </div>
);
```

## 🚨 Error Handling

### Media Access Errors

```javascript
try {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  setLocalStream(stream);
} catch (error) {
  if (error.name === "NotAllowedError") {
    showNotification("Camera/microphone access denied");
  } else if (error.name === "NotFoundError") {
    showNotification("No camera/microphone found");
  }
}
```

### Connection Errors

```javascript
peerConnection.addEventListener("connectionstatechange", () => {
  if (peerConnection.connectionState === "failed") {
    showNotification("Connection lost - attempting to reconnect...");
    attemptReconnection();
  }
});
```

### Socket.IO Errors

```javascript
socket.on("connect_error", (error) => {
  showNotification("Connection to server failed");
  setConnectionStatus("disconnected");
});
```

## 🔍 Debugging and Monitoring

### Console Logging

```javascript
console.log("🎬 [App] User joined room:", { userName, roomId, userRole });
console.log("🔗 [WebRTC] Peer connection established:", userId);
console.log("📡 [Socket] Event received:", eventType, data);
```

### Connection State Monitoring

```javascript
peerConnection.addEventListener("iceconnectionstatechange", () => {
  console.log("ICE connection state:", peerConnection.iceConnectionState);
});

peerConnection.addEventListener("signalingstatechange", () => {
  console.log("Signaling state:", peerConnection.signalingState);
});
```

### Performance Metrics

```javascript
setInterval(() => {
  peerConnection.getStats().then((stats) => {
    stats.forEach((report) => {
      if (report.type === "inbound-rtp" && report.mediaType === "video") {
        console.log("Video bitrate:", report.bytesReceived);
      }
    });
  });
}, 5000);
```

## 📊 Component Metrics

### Bundle Size Impact

- **Core Component**: ~15-20KB minified
- **Dependencies**: React (~40KB), Socket.IO client (~60KB)
- **Total Impact**: ~100-120KB for video calling functionality

### Performance Characteristics

- **Initial Render**: ~50-100ms depending on device count
- **Stream Setup**: ~500-1000ms for camera/microphone access
- **Peer Connection**: ~1-3 seconds for WebRTC negotiation
- **Memory Usage**: ~10-50MB depending on video quality

### Browser Compatibility

- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Good support (some limitations)
- **Edge**: Full support
- **Mobile**: Partial support (iOS Safari, Chrome Android)

## 🚀 Advanced Features

### Screen Sharing

```javascript
const startScreenShare = async () => {
  try {
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    // Replace video track in peer connections
    replaceVideoTrack(screenStream.getVideoTracks()[0]);
  } catch (error) {
    showNotification("Screen sharing not supported");
  }
};
```

### Recording Integration

```javascript
const startRecording = () => {
  const mediaRecorder = new MediaRecorder(localStream);
  mediaRecorder.ondataavailable = (event) => {
    // Save recording data
    saveRecordingChunk(event.data);
  };
  mediaRecorder.start();
};
```

### Bandwidth Adaptation

```javascript
peerConnection.addEventListener("iceconnectionstatechange", () => {
  if (peerConnection.iceConnectionState === "connected") {
    // Monitor connection quality and adjust video quality
    adaptBandwidth();
  }
});
```

## 🔒 Security Considerations

### Media Security

- **HTTPS Required**: WebRTC requires secure context
- **Permission Management**: Proper handling of media permissions
- **Stream Encryption**: All media streams are encrypted by default

### Data Protection

- **No Persistent Storage**: Streams not stored locally
- **Secure Transmission**: All data encrypted in transit
- **Access Control**: Room-based access management

### Privacy Features

- **Mute Controls**: Users can disable audio/video anytime
- **Leave Anytime**: Users can exit calls without restrictions
- **No Recording by Default**: Recording requires explicit setup

---

**File Location**: `/client/src/App.jsx` (Main React application component)  
**Dependencies**: `react`, `socket.io-client`  
**Browser APIs**: WebRTC, MediaDevices, Socket.IO  
**Last Updated**: August 23, 2025
