import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranscriptionService } from '../../src/services/transcriber';

const TOKEN = 'sentinel-hf-token';
const TRANSCRIPT_CANARY = 'TRANSCRIPT-CANARY-SHOULD-NOT-LEAK';
const fakeWhisperPath = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'fake-whisper.mjs',
);

describe('TranscriptionService child protocol', () => {
  let tempDir: string;
  let audioPath: string;
  let transcriptPath: string;
  let protocolPath: string;
  let logs: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcriber-'));
    audioPath = path.join(tempDir, 'canonical audio.wav');
    transcriptPath = path.join(tempDir, 'canonical Transcript.txt');
    protocolPath = path.join(tempDir, 'protocol.json');
    fs.writeFileSync(audioPath, 'audio');
    logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    for (const log of logs) log.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createTranscriber(mode: 'success' | 'fail') {
    return new TranscriptionService({
      executablePath: process.execPath,
      scriptPath: fakeWhisperPath,
      environment: {
        ...process.env,
        FAKE_WHISPER_MODE: mode,
        FAKE_WHISPER_PROTOCOL_PATH: protocolPath,
        FAKE_WHISPER_TRANSCRIPT_CANARY: TRANSCRIPT_CANARY,
        HUGGING_FACE_TOKEN: TOKEN,
      },
    });
  }

  it('passes exact paths in argv, transfers the token only in env, and discards child output', async () => {
    const transcriber = createTranscriber('success');

    await expect(transcriber.transcribe(audioPath, transcriptPath, {
      model: 'small',
      batchSize: 8,
      language: 'en',
      minSpeakers: 2,
      maxSpeakers: 4,
    })).resolves.toEqual({ outputFilePath: transcriptPath });

    const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
    expect(protocol).toEqual({
      argv: [
        audioPath,
        '--model', 'small',
        '--batch_size', '8',
        '--output_file', transcriptPath,
        '--language', 'en',
        '--min_speakers', '2',
        '--max_speakers', '4',
      ],
      token: TOKEN,
    });
    expect(protocol.argv).not.toContain(TOKEN);

    const observable = logs.flatMap((log) => log.mock.calls).flat().join(' ');
    expect(observable).not.toContain(TOKEN);
    expect(observable).not.toContain(TRANSCRIPT_CANARY);
  });

  it('returns a redacted error when the child emits secrets and Transcript text before failing', async () => {
    const transcriber = createTranscriber('fail');

    let thrown: unknown;
    try {
      await transcriber.transcribe(audioPath, transcriptPath, {});
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toEqual(new Error('Transcription failed (code 23).'));
    const observable = [
      thrown instanceof Error ? thrown.message : String(thrown),
      ...logs.flatMap((log) => log.mock.calls).flat(),
    ].join(' ');
    expect(observable).not.toContain(TOKEN);
    expect(observable).not.toContain(TRANSCRIPT_CANARY);
  });
});
