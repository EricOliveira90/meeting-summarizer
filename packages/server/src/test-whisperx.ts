import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { transcriptionService } from './services/transcriber';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎛️  CONFIGURATION — Edit these values before running
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Path to the .wav file (relative to packages/server/ or absolute) */
const WAV_FILE = '2026-04-01_THI_1P.wav';

/** WhisperX model: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'turbo' */
const MODEL = 'small';

/** Language code (e.g. 'en', 'pt', 'es') or undefined for auto-detect */
const LANGUAGE: string | undefined = 'pt';

/** Minimum number of speakers for diarization, or undefined for auto */
const MIN_SPEAKERS: number | undefined = 3;

/** Maximum number of speakers for diarization, or undefined for auto */
const MAX_SPEAKERS: number | undefined = 3;

/** Batch size for WhisperX inference (use 8 for CPU, 16+ for GPU) */
const BATCH_SIZE: number = 8;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  // Resolve to absolute path
  const audioPath = path.isAbsolute(WAV_FILE)
    ? WAV_FILE
    : path.resolve(process.cwd(), WAV_FILE);

  // Validate file exists
  if (!fs.existsSync(audioPath)) {
    console.error(`❌ File not found: ${audioPath}`);
    process.exit(1);
  }

  // Print config
  console.log(`
🎙️  WhisperX Dev Runner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 Input:        ${path.basename(audioPath)}
📂 Full Path:    ${audioPath}
🤖 Model:        ${MODEL}
🌐 Language:     ${LANGUAGE ?? 'auto-detect'}
👥 Min Speakers: ${MIN_SPEAKERS ?? 'auto'}
👥 Max Speakers: ${MAX_SPEAKERS ?? 'auto'}
📦 Batch Size:   ${BATCH_SIZE}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  const startTime = Date.now();

  try {
    const transcriptPath = path.resolve(
      process.cwd(),
      'transcriptions',
      `${path.parse(audioPath).name}.txt`,
    );
    const result = await transcriptionService.transcribe(audioPath, transcriptPath, {
      model: MODEL,
      language: LANGUAGE,
      batchSize: BATCH_SIZE,
      minSpeakers: MIN_SPEAKERS,
      maxSpeakers: MAX_SPEAKERS,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Done!
📄 Output: ${result.outputFilePath}
⏱️  Duration: ${elapsed}s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  } catch (error: any) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ Transcription Failed (after ${elapsed}s)
Error: ${error.message}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    process.exit(1);
  }
}

main();
