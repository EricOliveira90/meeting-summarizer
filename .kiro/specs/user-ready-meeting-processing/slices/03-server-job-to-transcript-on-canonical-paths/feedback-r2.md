## Evaluator feedback — round 2

VERDICT: REVISE
GAPS: 1
RE_RAISED_GAPS: 0

### If REVISE, specific gaps:
- **In scope / Test plan:** The contract promises that "`failures identify the active step`," but the gated lifecycle case covers only successful release through extraction and transcription, while the only planned process failure is "`a fake Whisper ... on failure`." Existing queue prior art also asserts only a transcription failure. An implementation that reports every extraction and transcription failure as `TRANSCRIBING` can therefore pass the stated plan while violating the promise for extraction failures. This violates falsifiability; add authenticated status cases that fail the extractor and transcriber separately and assert `FAILED` with `failedStep` equal to `EXTRACTING_AUDIO` and `TRANSCRIBING`, respectively.
