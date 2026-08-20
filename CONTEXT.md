# Meeting Processing

This context turns a recorded meeting into a transcript, summary, and optional
published note while preserving visible progress and recovery.

## Language

**Job**:
The durable record of processing one Recording through transcription and
summarization. A Job is complete when its Transcript and Summary are available.
_Avoid_: Sync, task, server job, client job

**Recording**:
The audio captured for one meeting and used as the source of a Job.
_Avoid_: Upload, media file

**Transcript**:
The speaker-attributed text produced from a Recording.
_Avoid_: Transcription

**Summary**:
The structured meeting result produced from a Transcript by one Summary
Provider.
_Avoid_: Note, AI output

**Summary Provider**:
The selected local AI tool that produces a Summary. A Job uses one provider at
a time and changes provider only through an explicit user choice.
_Avoid_: AI provider, summarizer

**Publication**:
The pipeline operation that renders a completed Job into an Obsidian note.
Publication has its own outcome and may retry or fail without making the Job
incomplete.
_Avoid_: Note generation, completion

