# 🎙️ Meeting Transcriber & Summarizer

> **A Local-First, AI-Powered Meeting Assistant.**
> Record meetings on your work laptop, process them securely on your powerful home PC, and get structured summaries directly in your Obsidian vault.

---

## 🏗️ Architecture

This project solves the "Work Laptop" restriction problem using a **Reverse SSH Tunnel** architecture. It allows a restricted corporate laptop to offload heavy AI processing (WhisperX + Gemini) to a personal computer without using VPNs or opening home firewall ports.

**The "Jump Box" Strategy:**

1. **Home PC (Server):** Connects *outbound* to a Google Cloud VM to expose port 3000.
2. **Work Laptop (Client):** Connects *outbound* to the same VM to access that port locally.
3. **Result:** The Client talks to `localhost:3000`, and traffic is encrypted end-to-end.

---

## 🚀 Prerequisites

### Hardware

* **Home PC (Server):** Windows 10/11, NVIDIA GPU (Recommended for WhisperX), Node.js (LTS), Python 3.10+.
* **Work Laptop (Client):** Windows 10/11, [`audio-rec`](https://github.com/user/audio-rec) CLI tool installed (Rust-based, globally available in PATH), FFmpeg installed.
* **Cloud:** A Google Cloud Platform (GCP) Free Tier account.

### Software Keys

* **Google Gemini API Key:** For summarization.
* **HuggingFace Token:** For Pyannote Speaker Diarization.

---

## 🛠️ Phase 1: The Bridge (Google Cloud VM)

We need a neutral "Jump Box" to connect your two computers.

1. **Create a VM:**
* Go to **Google Cloud Console** -> **Compute Engine**.
* Create an `e2-micro` instance (Region: `us-east1` or `us-central1`).
* OS: **Ubuntu 22.04 LTS**.
* **External IP:** Note this down (e.g., `35.196.xxx.xxx`).


2. **Generate SSH Keys:**
* **On Home PC (PowerShell):** `ssh-keygen -t ed25519 -C "bridge-user" -f $env:USERPROFILE\.ssh\gcp_key`
* **On Work Laptop (CMD):** `ssh-keygen -t ed25519 -C "bridge-user"`
* **Copy Public Keys:** Copy the content of the `.pub` files from both machines.


3. **Authorize Keys:**
* In GCP Console -> VM Instance -> **Edit** -> **SSH Keys**.
* Add **both** public keys. Ensure the username (left of the key) is `bridge-user`.



---

## 🏠 Phase 2: The Server (Home PC)

This machine handles the heavy lifting: FFmpeg processing, Whisper transcription, and Gemini summarization.

### 1. Installation

```powershell
# Clone repo
git clone https://github.com/EricOliveira90/meeting-summarizer.git
cd meeting-summarizer

# Install dependencies
npm install

# Install System Tools
# 1. Install FFmpeg and add to PATH.
# 2. Install Python 3.10+ and create venv for WhisperX
cd packages/server
python -m venv venv-whisperx
.\venv-whisperx\Scripts\activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install whisperx

```

### 2. Configuration (`packages/server/.env`)

```env
PORT=3000
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-flash-preview
AI_PROVIDER=gemini
HUGGING_FACE_TOKEN=hf_...
API_KEY=your-secure-random-string-for-client-auth

```

### 3. Start with PM2 (Process Manager)

We use PM2 to run both the Node Server and the SSH Tunnel automatically.

**Create `ecosystem.config.js` in root:**

```javascript
module.exports = {
  apps: [
    {
      name: "server",
      script: "npm",
      args: "run start:server",
      cwd: "./packages/server",
      env: { HOST: "127.0.0.1", PORT: 3000 }
    },
    {
      name: "tunnel",
      script: "ssh",
      // Connects Home PC Port 3000 -> Cloud VM Port 8080
      args: "-i C:\\Users\\You\\.ssh\\gcp_key -o ServerAliveInterval=60 -R 8080:127.0.0.1:3000 bridge-user@xx.xxx.xxx.xxx -N",
      autorestart: true
    }
  ]
};

```

**Run it:**

```powershell
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save

```

---

## 💼 Phase 3: The Client (Work Laptop)

This CLI tool records the screen/audio and syncs the data.

### 1. Installation

```bash
cd packages/client
npm install

```

### 2. Audio Recording Setup

The client uses **`audio-rec`**, a lightweight Rust CLI tool for recording system audio and microphone input. No GUI applications (like OBS) are needed.

**Install `audio-rec`:**

```powershell
# audio-rec must be globally available in PATH
# Install via cargo (Rust toolchain required):
cargo install audio-rec

# Verify installation:
audio-rec --version
```

**Configure audio devices:**

```bash
# Run the audio setup wizard from the CLI:
npm start
# Select "Audio Setup 🎙️" from the menu
# Or run directly:
npx ts-node src/index.ts audio
```

The setup wizard will:
* List all available input devices (microphones) and output devices (speakers)
* Let you select which devices to use for recording
* Save device indices to config (or use system defaults)

> ⚠️ **Note:** Device indices may change if audio devices are plugged/unplugged. Re-run audio setup if your devices change.

### 3. Configuration

The client uses a config store (managed via the setup wizard). Key settings:

```json
{
  "audioRec": {
    "inputDeviceIndex": 0,
    "outputDeviceIndex": 0
  },
  "server": {
    "ip": "127.0.0.1",
    "port": 3000,
    "apiKey": "your-secure-random-string-for-client-auth"
  },
  "paths": {
    "output": "C:\\Users\\Work\\Videos\\Meetings",
    "obsidianVault": "C:\\Users\\Work\\Documents\\Obsidian\\Vault"
  }
}
```

Run `npm start` and select **Settings ⚙️** to configure server connection and paths.
Run **Audio Setup 🎙️** to configure recording devices.


### 4. Connect the Tunnel

Run this command in a background terminal to link your laptop to the cloud bridge.

```cmd
# Connects Laptop Port 3000 -> Cloud VM Port 8080
ssh -o ServerAliveInterval=60 -L 3000:localhost:8080 bridge-user@xx.xxx.xxx.xxx -N

```

---

## 🔧 Server API

All endpoints require `x-api-key` header for authentication.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/` | Health check — returns `{ status: 'online' }` |
| `POST` | `/upload` | Upload a file for processing (headers: `x-job-id`, `x-language`, `x-template`) |
| `GET` | `/jobs` | Paginated job listing — query: `?page=1&limit=20&status=COMPLETED` |
| `GET` | `/jobs/:id` | Get job details with hydrated transcript/summary text |
| `DELETE` | `/jobs/:id` | Delete job, cancel if processing, remove all files |
| `POST` | `/jobs/:id/retry` | Retry a FAILED job from the step that failed (409 if not FAILED) |

### Job Processing Steps

Each job progresses through: `QUEUED` → `EXTRACTING_AUDIO` → `TRANSCRIBING` → `SUMMARIZING` → `DONE`

The `GET /jobs/:id` response includes `currentStep`, `failedStep`, and per-step timestamps.

### AI Provider

The server uses a pluggable AI provider system. Set `AI_PROVIDER` env var (default: `gemini`). To add a new provider, implement the `AIProvider` interface and register it in the factory.

### Resilience

- **Startup Recovery:** Stalled `PROCESSING` jobs are automatically recovered on restart (3-strike policy: resume → retry from scratch → mark FAILED).
- **Graceful Shutdown:** `SIGINT`/`SIGTERM` pauses the queue and waits for the current job to finish before exiting.

---

## ⏯️ Usage Guide

### 1. Recording a Meeting

1. Run the CLI: `npm start` (in `packages/client`).
2. Select **🔴 Start Recording**.
3. If pre-created meetings exist, select one from the picker — or choose **"Record without meeting"** for an ad-hoc recording.
4. Enter an optional title (or press Enter to skip — you can name it after recording).
5. Recording starts via `audio-rec` (WAV format, professional quality).
6. **Hotkeys during recording:**
   * `M`: Toggle Microphone Mute/Unmute.
   * `ENTER`: Stop Recording.
7. Real-time feedback shows audio state, processing progress, and completion info.
8. After stopping, if you skipped the title, you'll be prompted to name the recording.
9. Files are saved as `YYYY-MM-DD_HH-mm_Title.wav` in your configured output directory.

### 2. Syncing & Transcribing

1. Ensure your SSH Tunnel is running.
2. Select **🧠 Sync & Summarize**.
3. Choose the recording from the list.
4. Select Template: **Meeting** (Action Items) or **Training** (Concepts).
5. The Client uploads the audio -> Server processes it -> Client downloads the Markdown.

---

## ❓ Troubleshooting

| Issue | Cause | Fix |
| --- | --- | --- |
| **`ECONNREFUSED 127.0.0.1:3000`** | Tunnel is down. | Check if the `ssh -L` command is running on your laptop. |
| **`ECONNRESET`** | Server IP mismatch. | Ensure Server listens on `127.0.0.1` (not `::1`) and `ssh -R` points to `127.0.0.1`. |
| **`audio-rec could not be started: spawn audio-rec ENOENT`** | `audio-rec` not installed or not in PATH. | Install `audio-rec` via `cargo install audio-rec` and ensure it's in your system PATH. |
| **`FFmpeg is not installed or not found in PATH`** | FFmpeg missing. | Install FFmpeg and add it to your system PATH. `audio-rec` requires FFmpeg for audio processing. |
| **No audio devices found** | `audio-rec` can't detect devices. | Check that audio devices are connected. Run `audio-rec devices` to verify. |
| **Device indices changed** | Devices plugged/unplugged. | Re-run **Audio Setup 🎙️** from the menu to reconfigure device indices. |
| **Transcription Error** | VRAM / CUDA. | Ensure Home PC GPU drivers are updated and `whisperx` is installed correctly. |
