> **System Context & Architectural Guidelines for Meeting Transcriber Project**

## 1. Project Overview
This is a local-first **Meeting Transcriber & Summarizer** system for a hobbyist user.
* **Goal:** Record meetings via OBS, transcribe audio using OpenAI Whisper (local), and summarize using Google Gemini (API).
* **User Base:** 2 users, Windows 11 environment.
* **Networking:** Hybrid. Sprint 1 is Local LAN. Wave 2 (future) utilizes Tailscale Mesh VPN.

## 2. Tech Stack & Libraries
**Runtime:** Node.js (Latest LTS) with TypeScript (Strict Mode).
**Monorepo Structure:** `npm workspaces` or standard directory separation.

### Packages
* **`packages/client` (CLI App):**
    * `commander`: CLI commands & flags.
    * `inquirer`: Interactive menus.
    * `obs-websocket-js`: Controlling OBS Studio.
    * `axios`: HTTP client for server communication.
    * `node-global-key-listener`: Listening for 'M' (mute) and 'Enter' (stop) during recording.
    * `conf`: Persisting user settings (IPs, device IDs).
* **`packages/server` (Processing Hub):**
    * `fastify`: High-performance web framework.
    * `fastify-multipart`: File uploads.
    * `better-queue`: Queue management for transcriptions.
    * `lowdb`: JSON-based database for job tracking.
    * `@google/generative-ai`: Gemini API SDK.
    * `fluent-ffmpeg`: Audio extraction.
    * **External Dependency:** Python 3.x with `openai-whisper` installed.
* **`packages/shared`:** TypeScript interfaces shared between client/server.

## 3. Architecture & Data Flow

### A. Recording Flow (Client)
1.  **Connect:** Client connects to OBS via WebSocket (localhost).
2.  **Setup:** Checks/Configures Scene with specific Input (Mic) and Output (Desktop Audio) sources.
3.  **Action:** Starts Recording -> User presses 'M' to toggle Mic Mute -> User presses 'Enter' to Stop.
4.  **Save:** Renames MKV file to `YYYY-MM-DD_HH-mm_Title.mkv`.

### B. Processing Flow (Server)
1.  **Ingest:** Accepts `.mkv` upload -> Saves to `/uploads`.
2.  **Queue:** Job added to `better-queue`.
3.  **Extract:** FFMPEG extracts audio to `.wav` (16kHz mono).
4.  **Transcribe:** Spawns Python process (`whisper`) to generate text.
5.  **Summarize:** Sends transcript to Gemini 1.5 Pro with "Executive Assistant" persona prompt.
6.  **Store:** Updates DB with status, transcript, and markdown summary.

### C. Sync Flow
1.  Client polls Server for "Completed" jobs.
2.  Server returns payload.
3.  Client saves `.txt` transcript to file.
4.  Client generates `.md` file in the user's **Obsidian Vault** using the template below.

## 4. Coding Standards & Rules

1.  **Strict Typing:** No `any`. Define interfaces in `packages/shared`.
2.  **Error Handling:**
    * Client must handle "Server Offline" gracefully (allow recording without upload).
    * OBS connection failures must provide clear "Check OBS WebSocket Settings" instructions.
3.  **Networking:**
    * **Server:** Must listen on `0.0.0.0` (Host) to accept LAN/VPN connections.
    * **Client:** Configurable Server IP (defaults to `localhost`, user can change to LAN IP).
4.  **Windows Compatibility:** Use `path.join()` for all file paths. Handle Windows-style backslashes correctly.
5.  **Simplicity:** Prefer readable, imperative code over complex abstractions. This is a hobby project.
