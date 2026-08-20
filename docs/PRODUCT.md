# Product

Meeting Summarizer is a personal two-machine workflow. The notebook records
Meetings and owns the user experience; the home PC performs GPU-heavy Whisper
transcription through a private Google-hosted SSH bridge.

## Current Product Work

The active product specification is
`.kiro/specs/user-ready-meeting-processing/prd.md` and GitHub issue #32. Its
child issues #33 through #47 are the approved implementation and acceptance slices.

## Product Invariants

- Recording a Meeting starts processing automatically.
- The home server produces a Transcript and performs no Summary work.
- The notebook uses one explicitly selected local Summary Provider at a time.
- A Job completes when its Transcript and Summary exist.
- Obsidian Publication remains automatic but has an independent outcome.
- The normal workflow requires no manual Sync or infrastructure command.
- The system serves one user and one notebook.

Use `CONTEXT.md` for canonical terms and the PRD for detailed stories, scope,
and acceptance decisions.
