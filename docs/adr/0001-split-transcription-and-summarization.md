---
status: accepted
---

# Split transcription and summarization between machines

The home PC owns upload storage, audio extraction, and Whisper transcription,
while the notebook owns Summary creation and Obsidian Publication. This keeps
GPU-heavy transcription on the home PC, keeps Summary Provider credentials and
selection on the user-facing notebook, and lets a Job complete when its
Transcript and Summary exist even if Publication must retry independently.

## Consequences

The client workflow runner is the authority for the end-to-end Job lifecycle,
while the server exposes only transcription work and artifacts. One configured
Summary Provider is used at a time; changing providers is an explicit user
action rather than an automatic fallback that could send a Transcript to an
unexpected provider.
