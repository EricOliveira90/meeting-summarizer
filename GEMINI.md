# System Architecture & Context: Meeting Transcriber

## 1. Project Overview

**Type:** Local-first Monorepo (Node.js/TypeScript) for recording, transcribing, and summarizing meetings.
**Target Environment:** Windows 11 (PowerShell/Command Prompt).
**Network Architecture:** Reverse SSH Tunnel (Jump Box) for secure remote access.

**Core Strategy:**

1. **Client (CLI):** Controls OBS Studio for recording and syncs data via a local tunnel.
2. **Server (Local API):** hosted on a Personal PC, processes heavy workloads (FFmpeg, WhisperX, Gemini).
3. **Bridge (Jump Box):** A Google Cloud VM acts as a secure rendezvous point to connect Client and Server without exposing home ports.

---

## 2. Network & Security Architecture

### The "Jump Box" Strategy

To bypass corporate firewalls and avoid exposing home network ports, the system uses a **Reverse SSH Tunnel** through a neutral Cloud VM.

* **Cloud VM:** Google Cloud `e2-micro` (Ubuntu) running `sshd`.
* **Home PC (Server):** Initiates an outbound Remote Forward (`-R`).
* **Work Laptop (Client):** Initiates an outbound Local Forward (`-L`).

### Data Flow

`Client App` -> `127.0.0.1:3000` (Work Laptop) -> `SSH Tunnel` -> `Cloud VM (loopback)` -> `SSH Tunnel` -> `127.0.0.1:3000` (Home PC) -> `Node.js Server`

### Security Constraints

1. **Binding:** Server must listen strictly on `127.0.0.1` (IPv4).
2. **API Key:** All requests must include `x-api-key` header to prevent unauthorized access via the shared tunnel.
3. **Timeouts:** Server `keepAliveTimeout` set to 120s to handle SSH latency.

---

## 3. Monorepo Structure & Tech Stack

### Root

* **Manager:** `npm workspaces`
* **Runtime:** Node.js (Latest LTS)
* **Process Manager:** `pm2` (Manages Server + SSH Tunnel on Home PC).

### `packages/client` (The CLI)

* **Framework:** `commander`, `inquirer`.
* **Network:** `axios` configured to talk to `127.0.0.1`.
* **OBS Integration:** `obs-websocket-js`.

### `packages/server` (The Processing Hub)

* **Framework:** `fastify` + `@fastify/multipart`.
* **Queue:** `better-queue` (backed by `lowdb`).
* **AI/ML:** `whisperx` (Python/PyTorch), `google-generative-ai`.

---

## 4. Shared Domain Models (`@shared`)

### Enums

```typescript
enum TranscriptionLanguage {
  AUTO = 'auto',
  ENGLISH = 'en',
  PORTUGUESE = 'pt',
  SPANISH = 'es'
}

enum AIPromptTemplate {
  MEETING = 'meeting',   // Action Items & Decisions
  TRAINING = 'training', // Key Concepts & Q&A
  SUMMARY = 'summary'    // Brief TL;DR
}

```

---

## 5. [Client] Logic & Workflows

### A. Configuration Schema (`AppConfig`)

```typescript
interface AppConfig {
  obs: { ip: string; port: number; password?: string; };
  server: {
    ip: "127.0.0.1"; // Fixed: Always localhost due to SSH Tunnel
    port: 3000;
    apiKey: string;  // Required for authentication
  };
  paths: { output: string; obsidianVault?: string; };
  audio: { micId?: string; systemId?: string; };
}

```

### B. Recording Workflow

1. **OBS Connection:** Connect via WebSocket.
2. **Scene Automation:** Auto-create `wasapi_input_capture` (Mic) and `wasapi_output_capture` (Desktop).
3. **Active Recording:** Global Hotkeys (`M` Mute, `ENTER` Stop) with raw-mode `stdin` draining.
4. **Post-Processing:** Stop -> Rename with Retry Loop (Windows EBUSY handling).

### C. Sync Workflow

1. **Tunnel Check:** Ping `http://127.0.0.1:3000` to ensure SSH tunnel is active.
2. **Upload:** Stream via `multipart/form-data` with `x-api-key`.
3. **Poll:** Check `/jobs/:id` until `COMPLETED`.
4. **Artifacts:** Generate `.txt` transcript and formatted `.md` for Obsidian.

---

## 6. [Server] Architecture & Pipeline

### A. Process Management (PM2)

The Home PC runs `ecosystem.config.js` to manage lifecycle:

1. **App:** `npm run start:server` (Node.js API).
2. **Tunnel:** `ssh -R ...` (Persistent connection to Cloud VM).

### B. Directory Structure

```text
packages/server/
├── audio_cache/       # Temp .wav
├── transcriptions/    # Whisper Output
├── summaries/         # Gemini Output
├── uploads/           # Raw .mkv (Deleted after extraction)
├── scripts/           # Python scripts
└── db.json            # Job State

```

### C. Processing Stages (Queue: Concurrency 1)

1. **Ingestion:** Verify `x-api-key` -> Stream upload -> Queue Job.
2. **Extraction (FFmpeg):** MKV -> .wav (16kHz Mono).
3. **Transcription (Python Bridge):**
* Spawn `whisper-x.py` in `venv`.
* **Crucial:** Parse `stdout` for JSON only. Suppress PyTorch logs.


4. **Summarization (Gemini):** Generate Markdown summary based on Template.

---

## 7. Implementation Constraints & Guardrails

### 1. Network & Tunneling

* **IPv4 Enforcement:** Server must listen on `127.0.0.1`, not `localhost` or `::1`, to match SSH forwarding behavior.
* **Keep-Alive:** SSH commands must use `-o ServerAliveInterval=60`. Node server must set `headersTimeout` > 120s.

### 2. Platform Specifics (Windows)

* **Pathing:** Use `path.join()`.
* **File Locking:** Implement backoff/retry for all file moves/renames.

### 3. Error Handling

* **Tunnel Down:** If Client `checkHealth()` fails with `ECONNREFUSED` or `ECONNRESET`, prompt user to check their SSH window.
* **Python:** Handle `weights_only=False` warning in PyTorch via monkey-patching in script.

### 4. Environment Variables

* `GEMINI_API_KEY`: Google AI.
* `HUGGING_FACE_TOKEN`: Pyannote Diarization.
* `API_KEY`: Custom secure string for Client-Server auth.
