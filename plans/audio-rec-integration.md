# Plan: Replace OBS Studio with audio-rec for Recording

> Source PRD: [GitHub Issue #10 — Client Package: Replace OBS Studio with audio-rec for Recording](https://github.com/EricOliveira90/meeting-summarizer/issues/10)

## Architectural decisions

Durable decisions that apply across all phases:

- **External tool**: `audio-rec` is a globally-installed Rust CLI tool (`audio-rec.exe` in PATH). The client spawns it via `child_process` — no WebSocket connections, no running GUI apps.
- **JSON protocol**: All communication with `audio-rec` is via structured JSON on stdout (one object per line). Event types: `started`, `audio_state`, `muted`, `processing`, `completed`, `cancelled`, `error`. Commands (`stop`, `mute`, `devices`, `status`) also return JSON.
- **Config model**: `ObsConfig` is removed from `AppConfig`. Replaced by `AudioRecConfig` with optional `inputDeviceIndex` and `outputDeviceIndex` (number | undefined). Existing `AudioConfig` with `micId`/`systemId` is superseded by device indices.
- **Recording defaults**: Format is always WAV, quality is always `professional`. These are not user-configurable.
- **File naming**: `YYYY-MM-DD_HH-mm_<Title>.wav` — timestamp always at the beginning, captured at recording start time. Placeholder title is `recording` when no title is provided upfront.
- **OBS files retained**: `obs.ts` and `obs-websocket-js` dependency stay in the codebase untouched for potential future use, but are not imported by any active workflow.
- **No new npm dependencies**: `AudioRecService` uses only Node.js built-in `child_process`.
- **DI pattern**: `AudioRecService` follows the existing service pattern (class with methods, singleton export). Hotkey handling via `node-global-key-listener` is unchanged.

---

## Phase 1: AudioRecService Core + Config Cleanup

**User stories**: 1, 2, 6, 17, 20, 21

### What to build

Create the `AudioRecService` — a deep module that wraps the `audio-rec` CLI tool. It spawns `audio-rec record` as a child process, reads JSON events from stdout line-by-line, and exposes `startRecording(options)`, `stopRecording(sessionId?)`, and `toggleMute(sessionId?)` methods. The service manages the child process lifecycle, parses the JSON protocol into typed events, and emits them via callbacks or EventEmitter.

Simultaneously, clean up all OBS references from the configuration layer: remove `ObsConfig` from domain configs, remove `obs` from `AppConfig`, remove OBS defaults and env vars from the config service, and remove OBS WebSocket prompts from the setup wizard. Add `AudioRecConfig` with optional device index fields and wire it into the config store.

Update the services index to export the new module. The `obs.ts` file and its export remain untouched.

Unit tests cover: correct command construction with flags, JSON event parsing for all event types, stop/mute command spawning, error handling (tool not found, malformed JSON, process exit with error).

### Acceptance criteria

- [ ] `AudioRecService` exists with `startRecording`, `stopRecording`, `toggleMute` methods
- [ ] `startRecording` spawns `audio-rec record` with correct flags (output path, format=wav, quality=professional, optional device indices, optional mic-muted)
- [ ] JSON stdout is parsed line-by-line into typed events (`started`, `audio_state`, `muted`, `processing`, `completed`, `cancelled`, `error`)
- [ ] `stopRecording` spawns a separate `audio-rec stop` process with optional session ID
- [ ] `toggleMute` spawns a separate `audio-rec mute` process with optional session ID
- [ ] `ObsConfig` is removed from domain configs; `AudioRecConfig` with `inputDeviceIndex?` and `outputDeviceIndex?` is added
- [ ] `obs` field is removed from `AppConfig`; `audioRec` field is added
- [ ] Config service no longer has OBS defaults or OBS env vars; has `audioRec` defaults (empty device indices)
- [ ] Setup wizard no longer prompts for OBS WebSocket IP, port, or password
- [ ] Error events from `audio-rec` are surfaced clearly (tool not installed, FFmpeg missing, etc.)
- [ ] Unit tests cover command construction, all JSON event types, stop/mute commands, and error scenarios

---

## Phase 2: Device Enumeration + Audio Setup

**User stories**: 14, 15, 16, 21, 22

### What to build

Extend `AudioRecService` with `getDevices()` and `getStatus()` methods. `getDevices()` spawns `audio-rec devices` and parses the JSON output into typed arrays of input devices (microphones) and output devices (speakers/headphones), each with index, name, default status, sample rate, and channel count. `getStatus()` spawns `audio-rec status` and returns active session info or null.

Rewrite the audio setup flow to use `getDevices()` instead of OBS. Present input and output devices via inquirer list prompts showing device name, index, and whether it's the system default. Save the selected device indices to the `audioRec` config section. When `startRecording` is called, it reads device indices from config and passes them as `-id`/`-od` flags (or omits them to use system defaults).

Wire the main entry point's `audio` command to the updated setup flow.

Unit tests cover: device JSON parsing into typed arrays, status parsing (active vs inactive), config persistence of selected indices, fallback to system defaults when no indices configured.

### Acceptance criteria

- [ ] `getDevices()` spawns `audio-rec devices` and returns typed input/output device arrays
- [ ] `getStatus()` spawns `audio-rec status` and returns session info or null
- [ ] Audio Setup menu item spawns `getDevices()`, presents devices via inquirer, and saves selected indices to config
- [ ] Device selection UI shows device name, index, default status, and sample rate
- [ ] `startRecording` passes `-id`/`-od` flags when device indices are configured
- [ ] `startRecording` omits device flags when no indices are configured (uses system defaults)
- [ ] Main entry point's `audio` command routes to the updated audio setup flow
- [ ] Audio Setup warns that device indices may change if devices are plugged/unplugged
- [ ] Unit tests cover device parsing, status parsing, config persistence, and default fallback

---

## Phase 3: Record Command — On-the-fly Flow

**User stories**: 1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 18, 19

### What to build

Rewrite the record command to use `AudioRecService` instead of OBS. This phase implements the on-the-fly recording path (no pre-created meeting).

The flow: user selects "Start Recording" → is prompted for an optional title ("Enter a title or press Enter to skip") → timestamp is captured → filename is constructed as `YYYY-MM-DD_HH-mm_Title.wav` (or `YYYY-MM-DD_HH-mm_recording.wav` if skipped) → `audioRecService.startRecording()` is called with the output path and configured device indices → recording begins.

During recording, hotkeys are active: M toggles mute via `audioRecService.toggleMute()`, Enter stops via `audioRecService.stopRecording()`. Real-time JSON events are displayed: audio state changes (system audio detected, mic detected, mute toggled), processing progress (merging, trimming), and completion (final file path and size).

After recording completes, if the title was skipped (placeholder used), the user is prompted for a title. The file is renamed from `YYYY-MM-DD_HH-mm_recording.wav` to `YYYY-MM-DD_HH-mm_New_Title.wav`, preserving the original timestamp.

Title sanitization: special characters replaced with underscores, consecutive underscores collapsed.

Remove all OBS-specific logic from the record command (OBS connection, disconnection, MKV renaming with retry logic, `Mic/Aux` mute handling).

Unit tests cover: file naming pattern for both title-provided and title-skipped paths, post-recording rename with timestamp preservation, title sanitization.

### Acceptance criteria

- [ ] Record command uses `AudioRecService` instead of OBS (no OBS connection/disconnection)
- [ ] User is prompted for an optional title before recording starts
- [ ] Filename follows `YYYY-MM-DD_HH-mm_Title.wav` pattern with timestamp at the beginning
- [ ] Skipping the title uses `recording` as placeholder in the filename
- [ ] Hotkey M toggles mute via `audioRecService.toggleMute()` with visual feedback
- [ ] Hotkey Enter stops recording via `audioRecService.stopRecording()`
- [ ] Audio state changes are displayed in real-time (system audio, mic, mute status)
- [ ] Processing progress is displayed (merging, trimming stages)
- [ ] Completion event shows final file path and file size
- [ ] Errors from `audio-rec` are displayed clearly
- [ ] Post-recording title prompt appears when title was skipped
- [ ] File is renamed preserving the original timestamp
- [ ] Title sanitization replaces special characters with underscores and collapses consecutive underscores
- [ ] All OBS-specific logic is removed from the record command
- [ ] Unit tests cover file naming, title sanitization, and post-recording rename

---

## Phase 4: Record Command — Pre-created Meeting Flow

**User stories**: 7, 11

### What to build

Add meeting picker integration to the record command. When the user selects "Start Recording", if pre-created meetings exist (status `CREATED`), show a picker listing them plus a "Record without meeting" option. Selecting a meeting provides the title and uses the current timestamp for the filename (`YYYY-MM-DD_HH-mm_Meeting_Title.wav`), then starts recording immediately — no title prompt needed.

Selecting "Record without meeting" falls through to the on-the-fly flow from Phase 3. If no `CREATED` meetings exist, the on-the-fly flow starts directly.

The meeting's status transitions to `RECORDING` when recording starts (this integrates with the existing `MeetingService` from the meeting-centric-workflow plan).

### Acceptance criteria

- [ ] Record command shows a meeting picker when `CREATED` meetings exist
- [ ] Picker lists meetings by title and scheduled time, plus a "Record without meeting" option
- [ ] Selecting a meeting sets the filename from the meeting title with current timestamp
- [ ] Selecting a meeting skips the title prompt and starts recording immediately
- [ ] "Record without meeting" falls through to the on-the-fly flow
- [ ] If no `CREATED` meetings exist, the on-the-fly flow starts directly (no empty picker shown)
- [ ] Meeting status transitions to `RECORDING` when recording begins
