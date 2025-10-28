# 🤖 Runner.cjs - Recording Bot Documentation

## 📋 Overview

The `runner.cjs` file is the **heart of the automated recording system** - a sophisticated bot that automatically joins video calls and records everything without human intervention.

## 🎯 Main Purpose

Think of this bot as an invisible videographer who:

- 👻 Shows up to meetings quietly (headless browser)
- 🎬 Records all participants automatically
- 📸 Takes periodic screenshots
- 📁 Organizes everything by timestamp and room
- 🚪 Leaves when the meeting ends

## 🏗️ Technical Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Node.js Bot   │    │  Headless Chrome │    │  Video Call App │
│                 │    │                  │    │                 │
│ • File saving   │◄──►│ • Canvas drawing │◄──►│ • WebRTC streams│
│ • Configuration │    │ • Audio mixing   │    │ • User interface│
│ • Process mgmt  │    │ • MediaRecorder  │    │ • Socket.IO     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 🔧 How It Works

### 1. **Environment Setup** 🌍

- Reads configuration from environment variables
- Creates output directories for recordings and screenshots
- Sets up Chrome browser arguments for automation

### 2. **Browser Automation** 🤖

- Launches headless Chrome browser (invisible window)
- Grants microphone/camera permissions automatically
- Uses fake media devices to avoid privacy popups

### 3. **Smart Recording System** 🎬

#### Video Composition

- Creates a canvas that acts like a movie screen
- Finds all participant video elements on the page
- Calculates grid layout for multiple participants
- Continuously draws video frames onto canvas
- Captures canvas as video stream at specified FPS

#### Audio Mixing

- Uses Web Audio API to mix all participant audio
- Creates a single combined audio stream
- Handles audio from video and audio elements

#### Multi-format Output

- **Main Recording**: Combined video + audio of all participants
- **Candidate Audio**: Optional separate audio track of main speaker
- **Screenshots**: Periodic JPEG snapshots

### 4. **File Management** 📁

- Generates timestamped filenames
- Saves to organized directory structure
- Handles both video (WebM) and image (JPEG) formats

## 🎮 Configuration Options

### Connection Settings

```bash
SIGNALING_URL="https://aira.airahr.ai"  # Server URL
ROOM_ID="demo-room"                     # Room to join
BOT_NAME="Recorder Bot"                 # Bot's display name
ROLE="observer"                         # Bot's role
DURATION_MIN="480"                      # Recording duration (minutes)
```

### Video Quality Settings

```bash
REC_WIDTH="1280"                        # Video width (pixels)
REC_HEIGHT="720"                        # Video height (pixels)
REC_FPS="25"                            # Frames per second
REC_CODEC="vp8"                         # Video codec (vp8/vp9)
VIDEO_BITRATE="1200000"                 # Video quality (bits/sec)
```

### Recording Output

```bash
REC_OUT_DIR="/path/to/recordings"       # Where to save videos
CANDIDATE_ONLY_AUDIO="1"                # Record separate audio track
```

### Screenshot Settings

```bash
SNAP_DIR="/var/snaps"                   # Photo storage folder
SNAP_EVERY_SEC="60"                     # Photo interval (seconds)
SNAP_WIDTH="640"                        # Photo width (pixels)
SNAP_QUALITY="0.8"                      # JPEG quality (0-1)
```

### Testing Options

```bash
FAKE_AUDIO_WAV="/path/to/audio.wav"     # Use WAV file instead of mic
```

## 🎮 Usage Examples

### Basic Recording

```bash
# Record a meeting for 60 minutes
ROOM_ID=my-meeting DURATION_MIN=60 node runner.cjs
```

### High-Quality Interview Recording

```bash
ROOM_ID=interview \
DURATION_MIN=120 \
REC_WIDTH=1920 \
REC_HEIGHT=1080 \
SNAP_EVERY_SEC=30 \
REC_OUT_DIR=/recordings \
CANDIDATE_ONLY_AUDIO=1 \
node runner.cjs
```

### Testing with Fake Audio

```bash
ROOM_ID=test-room \
DURATION_MIN=5 \
FAKE_AUDIO_WAV=/path/to/test.wav \
REC_OUT_DIR=/tmp/test \
node runner.cjs
```

## 💡 Real-World Use Cases

### 📼 Job Interviews

- Records candidate responses automatically
- Takes screenshots for visual assessment
- Separate audio tracks for detailed analysis
- No human intervention needed

### 🎓 Training Sessions

- Captures presentations with multiple speakers
- Automatic attendance screenshots
- Long-duration recording (up to 8 hours default)
- Professional quality output

### ⚖️ Legal Depositions

- High-quality recordings with timestamps
- Multiple evidence formats (video + stills)
- Reliable automated operation
- Organized file structure

### 🏢 Corporate Meetings

- Automatic meeting recording
- Multi-participant capture
- Easy playback and review
- Compliance documentation

## 📊 File Output Structure

```
/recordings/
└── room-name/
    ├── room-name-2024-08-23T14-30-00-123Z.webm     # Main recording
    ├── candidate-audio-2024-08-23T14-30-00-456Z.webm # Candidate audio
    └── /snapshots/
        ├── room-name-2024-08-23T14-30-00-789Z.jpg   # Screenshot 1
        ├── room-name-2024-08-23T14-31-00-012Z.jpg   # Screenshot 2
        └── ...
```

## 🚨 Important Considerations

### File Sizes 📊

- **Video**: ~1.2 Mbps = ~540 MB per hour
- **Audio**: Additional ~60 MB per hour
- **Total**: ~600 MB per hour per recording
- **Screenshots**: ~50-200 KB each
- **Plan storage accordingly!**

### System Requirements 🖥️

- **Chrome/Chromium**: Must be installed
- **Node.js**: With Playwright package
- **Disk Space**: Several GB for long recordings
- **Network**: Stable connection required
- **Memory**: ~500 MB RAM per bot instance

### Performance Tips ⚡

- Use SSD storage for better file I/O
- Monitor available disk space
- Consider video codec choice (VP8 vs VP9)
- Adjust quality settings based on needs
- Test thoroughly before production use

## 🛠️ Technical Implementation Details

### Browser Automation

- **Playwright**: Controls headless Chrome
- **Fake Media**: Avoids permission dialogs
- **Canvas API**: Combines multiple video streams
- **MediaRecorder**: Handles video encoding
- **Web Audio API**: Mixes participant audio

### Smart Join Logic

1. Try calling `window.join()` function if available
2. Look for buttons with text "join", "enter", "start", "continue"
3. Fall back to manual button detection
4. Assume auto-join if no buttons found

### Recording Process

1. **Discovery**: Find all participant video/audio elements
2. **Layout**: Calculate grid arrangement for multiple participants
3. **Drawing**: Continuously draw video frames to canvas
4. **Capture**: Convert canvas to video stream
5. **Mixing**: Combine all audio sources
6. **Recording**: Save to WebM files with timestamps

### Error Handling

- Graceful recovery from network issues
- Automatic retry for join attempts
- Safe cleanup on unexpected exits
- Comprehensive logging for debugging

## 🔍 Troubleshooting

### Common Issues

**Bot doesn't join the room**

- Check SIGNALING_URL is correct
- Verify room exists and is accessible
- Check network connectivity
- Look for join button text variations

**No video recorded**

- Ensure participants have cameras enabled
- Check video elements are found on page
- Verify sufficient disk space
- Check Chrome permissions

**Audio missing**

- Participants must have audio enabled
- Check Web Audio API support
- Verify audio elements detection
- Test with known working audio

**Large file sizes**

- Reduce VIDEO_BITRATE setting
- Lower REC_WIDTH/REC_HEIGHT
- Use VP8 instead of VP9 codec
- Shorten recording duration

## 🚀 Advanced Features

### Candidate-Only Audio

When `CANDIDATE_ONLY_AUDIO=1`:

- Looks for elements with `data-role="candidate"`
- Falls back to largest video stream
- Records separate audio track
- Useful for interview analysis

### Smart Screenshot Timing

- Takes initial screenshot immediately
- Continues at regular intervals
- Focuses on main participant
- Maintains aspect ratio

### Graceful Shutdown

- Heartbeat logging every minute
- Clean browser closure
- Proper file cleanup
- Exit status reporting

## 📝 Code Structure

### Main Components

1. **Configuration**: Environment variable parsing
2. **Utilities**: Timestamp generation, directory creation
3. **Browser Setup**: Chrome launch with permissions
4. **File Bindings**: Save functions exposed to browser
5. **Recording Logic**: Injected JavaScript for capture
6. **Join Process**: Automated room joining
7. **Lifecycle**: Duration management and cleanup

### Key Functions

- `startRecorders()`: Main video/audio recording
- `startSnapshots()`: Periodic screenshot capture
- `nowStamp()`: Timestamp generation
- `ensureDir()`: Directory creation
- `layout()`: Video grid calculation

This recording bot essentially turns any video call into a professionally recorded session with zero human intervention! 🎉

---

**File Location**: `/runner.cjs` (Root directory - main recording script)  
**Dependencies**: `playwright`, `fs`, `path`  
**Output Formats**: WebM video, JPEG images  
**Last Updated**: August 23, 2025
