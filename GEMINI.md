# System Architecture & Context: Meeting Transcriber

## 1. Project Overview

**Type:** Local-first Monorepo (Node.js/TypeScript) for recording, transcribing, and summarizing meetings.
**Target Environment:** Windows 11 (PowerShell/Command Prompt).
**Network Architecture:** Reverse SSH Tunnel (Jump Box) for secure remote access.

**Core Strategy:**

1. **Client (CLI):** Controls OBS Studio for recording and acts as an **Offline-First State Machine** that queues uploads, processes batches, and gracefully handles tunnel disconnects.
2. **Server (Local API):** Hosted on a Personal PC, processes heavy workloads (FFmpeg, WhisperX, Gemini).
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

---

## 3. Monorepo Structure & Tech Stack

### Root

* **Manager:** `npm workspaces`.
* **Runtime:** Node.js (Latest LTS).
* **Testing:** `vitest` (Dependency injection used for isolated testing).

### `packages/client` (The CLI)

* **Framework:** `commander`, `inquirer`.
* **State Management:** `lowdb` (Offline-first local queue).
* **Network:** `axios` configured to talk to `127.0.0.1`.
* **OBS Integration:** `obs-websocket-js`.

### `packages/server` (The Processing Hub)

* **Framework:** `fastify` + `@fastify/multipart`.
* **Queue:** `better-queue` (backed by its own `lowdb` instance).
* **AI/ML:** `whisperx` (Python/PyTorch), `google-generative-ai`.

---

## 4. Shared Domain Models (`@shared`)

*Rule: This package must remain pure. It contains ONLY Types and Enums. Do not install database drivers (like `lowdb`) here to ensure strict boundaries between Client and Server.*

### Enums

```typescript
// Unified Server Processing States
export type ServerJobState = 'PENDING' | 'EXTRACTING' | 'TRANSCRIBING' | 'SUMMARIZING' | 'COMPLETED' | 'FAILED';

export enum TranscriptionLanguage {
  AUTO = 'auto',
  ENGLISH = 'en',
  PORTUGUESE = 'pt',
  SPANISH = 'es'
}

export enum AIPromptTemplate {
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

1. **OBS Connection:** Connect via WebSocket and force unmute the microphone.
2. **Scene Automation:** Auto-create `wasapi_input_capture` (Mic) and `wasapi_output_capture` (Desktop).
3. **Active Recording:** Listen for Global Hotkeys (`M` to toggle Mute, `ENTER` to Stop) while actively draining `stdin` to prevent terminal buffering issues.
4. **Post-Processing:** Stop OBS -> Prompt user for Meeting Title -> Rename file with Retry Loop (handling Windows EBUSY locking) -> Add to Local DB as `WAITING_UPLOAD`.

### C. The "Magic Batch" Sync Workflow (`SyncManager`)

The CLI uses a strict, 4-step orchestration cycle to prevent data loss and handle network instability.

1. **Auto-Ingestion (`scanDirectory`):** Scans the local output folder for new, untracked media files. Prompts the user to title and configure AI options (Language, Template) for any new files found.
2. **Update States (`updateActiveStates`):** Polls the server (`GET /jobs/:id`) to check if any locally tracked `PROCESSING` jobs have finished. Updates the local DB to `READY` or `FAILED` accordingly.
3. **Fetch Results (`fetchResults`):** Downloads completed jobs (`READY`). Saves the raw summaries and transcriptions to local `.txt` files in the project directory, and renders the formatted output into the user's Obsidian vault. Marks job as `COMPLETED`.
4. **Push Pending (`pushPending`):** Uploads any `WAITING_UPLOAD` files or retries `FAILED` jobs (up to a max of 3 retries) via `multipart/form-data`.

### D. Local Reconciliation & Resilience

* **Ghost File Cleanup:** On startup, the CLI runs `cleanPhantomFiles()` to ensure jobs in the database still have matching physical files on the hard drive. If a user manually deletes a `.mkv`, the database record is safely marked as `DELETED` to prevent upload crashes.
* **Network Error Handling:** If the SSH Tunnel drops (`ECONNREFUSED`/`ECONNRESET`), the error is marked as transient, the job is flagged as `FAILED`, and the retry count increments. Fatal errors (e.g., 401 Unauthorized) mark the job as `ABANDONED` instantly.

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

* **Pathing:** Use `path.join()` or `path.resolve()` strictly to handle Windows backslashes properly.
* **File Locking:** Implement backoff/retry for all file moves/renames, as OBS and Windows often hold brief locks on media files.
* **Executable Packaging:** To distribute as a standalone `.exe`, absolute paths for user data (like `client-db.json` and `.env` configs) must point to a stable directory like `%APPDATA%`, rather than relying on `process.cwd()`.

### 3. Error Handling

* **Tunnel Down:** If Client `checkHealth()` fails with `ECONNREFUSED` or `ECONNRESET`, prompt user to check their SSH window.
* **Python:** Handle `weights_only=False` warning in PyTorch via monkey-patching in script.

### 4. Environment Variables

* `GEMINI_API_KEY`: Google AI.
* `HUGGING_FACE_TOKEN`: Pyannote Diarization.
* `API_KEY`: Custom secure string for Client-Server auth.