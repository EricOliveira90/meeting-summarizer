# Audio Rec

A Rust-based command-line tool for recording system audio and microphone on Windows. Designed to be **spawned by other tools** (e.g., AI assistants, automation scripts) via process spawning, with structured JSON output for easy integration.

## Features

- **Dual-channel recording** — Captures system audio (WASAPI loopback) and microphone simultaneously
- **Device selection** — Choose specific audio input/output devices by index
- **Device enumeration** — List all available audio devices with `audio-rec devices`
- **Enhanced status** — View active recording session info (elapsed time, devices, audio detection, etc.)
- **Structured JSON protocol** — All stdout output is JSON, one object per line, for easy parsing
- **Silence trimming** — Automatically trims leading/trailing silence and caps internal silence gaps at 2 seconds
- **Microphone mute** — Start muted or toggle mute during recording via IPC
- **Custom output path** — Save recordings wherever you want
- **Multiple formats** — WAV (lossless) and M4A (AAC compressed)
- **File-based IPC** — Stop, cancel, and mute via signal files (no sockets needed)

## Requirements

- **Windows 10/11** (uses WASAPI for audio capture)
- **FFmpeg** in PATH (required for audio merging, encoding, and silence trimming)
- **Rust toolchain** (for building from source)

## Building

```bash
cargo build --release
```

The binary will be at `target/release/audio-rec.exe`.

### Running from the Project Folder

```bash
cargo run --release -- record
cargo run --release -- stop
cargo run --release -- mute
```

### Install Globally

To make `audio-rec` available as a command from any folder:

```bash
cargo install --path cli
```

This installs `audio-rec.exe` to `~/.cargo/bin/` which is already in your PATH if you have Rust installed.

### Update Global Install

After pulling new changes or making local modifications, re-run the install command to update the global binary:

```bash
cargo install --path cli
```

This will rebuild and replace the existing `audio-rec.exe` in `~/.cargo/bin/`.

## Commands

### `record` — Start Recording

```bash
audio-rec record [options]
```

**Options:**

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--output <path>` | `-o` | Output file path (directory + filename) | `cwd/<auto-name>.wav` |
| `--duration <secs>` | `-d` | Recording duration in seconds | Indefinite (until `stop`) |
| `--format <wav\|m4a>` | `-f` | Audio format | `wav` (or inferred from `--output` extension) |
| `--quality <level>` | `-q` | Quality preset: `quick`, `standard`, `professional`, `high` | `professional` |
| `--input-device <idx>` | `-id` | Input device index (microphone). Use `devices` to list. | System default |
| `--output-device <idx>` | `-od` | Output device index (loopback). Use `devices` to list. | System default |
| `--mic-muted` | | Start with microphone muted | Off |
| `--no-trim` | | Disable automatic silence trimming | Trimming ON |

**Examples:**

```bash
# Record indefinitely, save to current directory
audio-rec record

# Record for 30 seconds
audio-rec record -d 30

# Record to a specific file
audio-rec record -o C:\recordings\meeting.wav

# Record as M4A with mic muted
audio-rec record -o standup.m4a --mic-muted

# Record without silence trimming
audio-rec record --no-trim -d 60

# Quick quality, standard format
audio-rec record -q quick -f m4a -d 120

# Record using specific input and output devices
audio-rec record -id 0 -od 1

# Record using a specific microphone
audio-rec record --input-device 1
```

### `stop` — Stop Recording

```bash
audio-rec stop [session_id]
```

Stops the active recording and triggers post-processing (merge, encode, trim). If no `session_id` is provided, stops the most recent active session.

### `mute` — Toggle Microphone Mute

```bash
audio-rec mute [session_id]
```

Toggles the microphone mute state on an active recording. When muted, the mic channel writes silence (zeros) instead of real audio, producing a continuous valid audio stream.

### `devices` — List Audio Devices

```bash
audio-rec devices
```

Lists all available audio input (microphone) and output (speakers/headphones) devices as JSON. Use the device indices with `--input-device` / `--output-device` flags on the `record` command.

**Example output:**

```json
{
  "type": "devices",
  "input_devices": [
    {"index": 0, "name": "Microphone (Blue Yeti)", "is_default": true, "sample_rate": 48000, "channels": 2}
  ],
  "output_devices": [
    {"index": 0, "name": "Speakers (Realtek)", "is_default": true, "sample_rate": 48000, "channels": 2},
    {"index": 1, "name": "HDMI Audio (NVIDIA)", "is_default": false, "sample_rate": 48000, "channels": 8}
  ]
}
```

> **Note:** Device indices may change between runs if devices are plugged/unplugged. Run `audio-rec devices` before each recording session to get current indices.

### `status` — Active Recording Info

```bash
audio-rec status
```

Shows information about the active recording session, including elapsed time, devices in use, audio detection status, and more. When no recording is active, reports that no session is found.

**Example output (active recording):**

```json
{
  "type": "status",
  "active": true,
  "session_id": "rec-20260329_120000",
  "filename": "recording.wav",
  "elapsed": "2m 34s",
  "duration": "indefinite",
  "format": "wav",
  "quality": "Professional (48kHz Stereo)",
  "is_mic_muted": false,
  "device": "Dual-Channel (System + Microphone)",
  "sample_rate": 48000,
  "loopback_has_audio": true,
  "mic_has_audio": true,
  "loopback_frames": 1500,
  "mic_frames": 1200
}
```

**Example output (no active recording):**

```json
{"type": "status", "active": false, "message": "No active recording session found"}
```

## JSON Protocol (stdout)

All stdout output follows a structured JSON protocol — one JSON object per line. This makes it easy for calling tools to parse output by reading lines and deserializing JSON.

### Event Types

#### `started` — Recording has begun

```json
{
  "type": "started",
  "session_id": "rec-20260320_114500",
  "file_path": "C:\\recordings\\meeting.wav",
  "duration": -1,
  "format": "wav",
  "quality": "Professional (48kHz Stereo)",
  "mic_muted": false,
  "trim_silence": true,
  "input_device": "Microphone (Blue Yeti)",
  "input_device_index": 0,
  "output_device": "Speakers (Realtek)",
  "output_device_index": 0
}
```

- `duration`: `-1` means indefinite, positive number means fixed seconds
- `input_device` / `output_device`: Only present when device selection flags are used

#### `audio_state` — Audio state changed

Emitted only when audio detection or mute state changes (not periodically). This keeps stdout quiet during normal recording.

```json
{
  "type": "audio_state",
  "session_id": "rec-20260320_114500",
  "loopback_has_audio": true,
  "mic_has_audio": false,
  "is_mic_muted": false
}
```

- Emitted when `loopback_has_audio`, `mic_has_audio`, or `is_mic_muted` changes
- Not emitted every second — only on actual state transitions

#### `muted` — Microphone mute state changed

```json
{
  "type": "muted",
  "session_id": "rec-20260320_114500",
  "is_muted": true
}
```

#### `processing` — Post-processing stage update

```json
{
  "type": "processing",
  "session_id": "rec-20260320_114500",
  "message": "Trimming silence",
  "elapsed_secs": 30
}
```

#### `completed` — Recording finished successfully

```json
{
  "type": "completed",
  "session_id": "rec-20260320_114500",
  "file_path": "C:\\recordings\\meeting.wav",
  "filename": "meeting.wav",
  "file_size_mb": "2.34",
  "format": "wav",
  "duration_secs": -1,
  "message": "Recording completed successfully"
}
```

#### `cancelled` — Recording was cancelled

```json
{
  "type": "cancelled",
  "session_id": "rec-20260320_114500",
  "message": "Recording cancelled by user"
}
```

#### `error` — An error occurred

```json
{
  "type": "error",
  "message": "FFmpeg is not installed or not found in PATH..."
}
```

### Stop/Mute Command Output

```json
{
  "status": "success",
  "data": {
    "session_id": "rec-20260320_114500",
    "message": "Stop signal sent successfully"
  }
}
```

## Integration Example

Here's how another tool (e.g., a Python script) would use this:

```python
import subprocess
import json

# Start recording
proc = subprocess.Popen(
    ["audio-rec", "record", "-o", "meeting.wav"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True
)

# Read events from stdout (only emitted on state changes, not every second)
for line in proc.stdout:
    event = json.loads(line.strip())
    
    if event["type"] == "started":
        print(f"Recording started: {event['session_id']}")
    
    elif event["type"] == "audio_state":
        print(f"Audio state changed - System: {event['loopback_has_audio']}, Mic: {event['mic_has_audio']}, Muted: {event['is_mic_muted']}")
    
    elif event["type"] == "muted":
        print(f"Mic muted: {event['is_muted']}")
    
    elif event["type"] == "completed":
        print(f"Done! File saved to: {event['file_path']}")
        print(f"Size: {event['file_size_mb']} MB")
        break

# To stop early (from another process/thread):
# subprocess.run(["audio-rec", "stop"])

# To toggle mute:
# subprocess.run(["audio-rec", "mute"])
```

## Architecture

```
audio-recorder-manager-efo/
├── Cargo.toml                    # Workspace root
├── core/                         # Library crate
│   └── src/
│       ├── lib.rs
│       ├── audio_utils.rs        # RMS audio level detection
│       ├── config.rs             # Storage/config management
│       ├── domain.rs             # AudioFormat, RecordingDuration, SessionId
│       ├── error.rs              # Error types
│       ├── ffmpeg_encoder.rs     # FFmpeg integration (merge, encode, trim, duration)
│       ├── logging.rs            # Dual-output logging (file + terminal)
│       ├── output.rs             # User-facing terminal output
│       ├── recorder.rs           # Quality presets, smart audio merge (4 scenarios)
│       ├── status.rs             # JSON status file observer
│       ├── commands/
│       │   ├── devices.rs        # Devices command (enumerate audio devices)
│       │   ├── record.rs         # Record command (main recording lifecycle)
│       │   ├── stop.rs           # Stop command (signal file IPC)
│       │   ├── mute.rs           # Mute toggle command (signal file IPC)
│       │   └── status.rs         # Status command (active session info)
│       └── wasapi/
│           ├── device_enumeration.rs  # WASAPI device enumeration & validation
│           ├── loopback.rs       # System audio capture (WASAPI loopback)
│           └── microphone.rs     # Microphone capture (with mute support)
├── cli/                          # Binary crate
│   └── src/
│       ├── main.rs               # Entry point, logging init
│       └── cli.rs                # Argument parsing, command dispatch
└── storage/                      # Runtime data (auto-created)
    ├── recordings/               # Temporary WAV files during recording
    ├── status/                   # JSON status files
    └── signals/                  # IPC signal files (.stop, .mute, .cancel)
```

### Recording Lifecycle

1. **Startup**: CLI parses flags, checks FFmpeg availability, creates session
2. **Recording**: WASAPI captures system audio + mic in parallel threads, writes temp WAV files
3. **Signal check loop**: Every 1s — checks signal files (.stop, .mute, .cancel) and detects audio state changes; emits JSON events only when state changes (not periodically)
4. **Stop**: Stops WASAPI recorders, waits for temp files to stabilize
5. **Merge**: FFmpeg merges loopback + mic into stereo (4 scenarios based on which channels have audio)
6. **Trim**: FFmpeg `silenceremove` filter trims leading/trailing silence, caps internal gaps at 2s
7. **Finalize**: Copies to final output path, emits `completed` JSON, cleans up temp files

### Audio Merge Scenarios

| Scenario | System Audio | Microphone | Strategy |
|----------|-------------|------------|----------|
| A | ✓ Has audio | ✓ Has audio | Dual-mono stereo (L=system, R=mic) |
| B | ✓ Has audio | ✗ Silent | Duplicate system to stereo |
| C | ✗ Silent | ✓ Has audio | Duplicate mic to stereo |
| D | ✗ Silent | ✗ Silent | Silent stereo file |

### IPC (Inter-Process Communication)

File-based signal files in `storage/signals/`:
- `{session_id}.stop` — Stop recording, proceed to post-processing
- `{session_id}.cancel` — Stop recording, discard everything
- `{session_id}.mute` — Toggle microphone mute

This approach is simple, cross-process compatible, and doesn't require sockets or shared memory.

## Silence Trimming

Enabled by default (disable with `--no-trim`). Uses FFmpeg's `silenceremove` filter:

- **Leading silence**: Removed completely
- **Trailing silence**: Removed completely
- **Internal silence**: Capped at 2 seconds (silence beyond 2s is removed, up to 2s is kept)
- **Threshold**: -50 dB (configurable in code)

If trimming fails (e.g., FFmpeg error), the original file is kept — trimming failure is non-fatal.

If the entire recording is silence, the original file is kept (empty file prevention).

## Logging

Logs go to two places:
- **File**: `%APPDATA%\audio-rec\logs\cli-YYYY-MM-DD.log` (daily rotation, 7-day retention)
- **Terminal**: stderr (can be disabled with `--no-log-terminal`)

Log level can be set with `--log-level <trace|debug|info|warn|error>` (default: `info`).

## Future Implementation Plans

- [ ] **Graceful shutdown** — Handle SIGTERM/Ctrl+C to properly finalize recordings instead of leaving corrupted temp files
- [ ] **Audio normalization** — Optional loudness normalization via FFmpeg's `loudnorm` filter after recording
- [ ] **Cross-platform support** — Linux (PulseAudio/PipeWire) and macOS (CoreAudio) recording backends
- [x] **Device selection** — Choose specific audio input/output devices by index (`--input-device` / `--output-device`)
- [x] **Device enumeration** — List available audio devices with `audio-rec devices`
- [x] **Enhanced status** — Show active recording session info (elapsed time, devices, audio detection, etc.)
- [ ] **Real-time audio level monitoring** — Emit audio level (RMS/peak) in progress events for VU meter display
- [ ] **Configurable silence parameters** — Expose silence threshold and max gap duration as CLI flags
- [ ] **Pause/resume** — Pause recording without stopping (write silence during pause, or stop/restart WASAPI)
- [ ] **Multiple output formats** — Support FLAC, OGG, MP3 output via FFmpeg
- [ ] **Pre-recording buffer** — Keep a rolling buffer so you never miss the start of audio
- [ ] **Automatic gain control** — Normalize mic levels in real-time during recording
