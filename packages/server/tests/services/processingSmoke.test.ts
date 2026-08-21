import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import FormData from 'form-data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import type { JobRecord } from '../../src/domain/models';

vi.mock('@google/genai', () => {
  throw new Error('Production server loaded Gemini.');
});
vi.mock('../../src/services/gemini-provider', () => {
  throw new Error('Production server loaded a Summary Provider.');
});
vi.mock('../../src/services/summarizer', () => {
  throw new Error('Production server loaded SummaryService.');
});

import { buildServer } from '../../src/index';
import { AudioExtractionService } from '../../src/services/audio-extractor';
import { FileManagerService } from '../../src/services/file-manager';
import {
  processMeetingJob,
  type ProcessingDependencies,
  type QueueInput,
} from '../../src/services/queue';
import { TranscriptionService } from '../../src/services/transcriber';

const execFileAsync = promisify(execFile);
const API_KEY = 'processing-smoke-api-key';
const JOB_ID = 'processing-smoke-job';
const TRANSCRIPT = 'Speaker 1: production processing sentinel';
const fixturePath = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'short-recording.wav',
);
const fakeWhisperPath = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'fake-whisper.mjs',
);

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((action) => action()));
});

describe('Production server processing smoke', () => {
  it('crosses real FFmpeg and fake Whisper before authenticated Transcript retrieval', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'processing-smoke-'));
    cleanup.push(() => fs.promises.rm(root, { recursive: true, force: true }));

    const artifacts = new FileManagerService(root);
    await artifacts.ensureDirectories();
    const jobs: JobRecord[] = [];
    const jobStore = {
      getAll: vi.fn(async () => jobs),
      getById: vi.fn(async (id: string) => jobs.find((job) => job.id === id)),
      replace: vi.fn(async (job: JobRecord) => {
        const index = jobs.findIndex((candidate) => candidate.id === job.id);
        if (index === -1) jobs.push(job);
        else jobs[index] = job;
      }),
      delete: vi.fn(async () => {}),
    };
    const processingDependencies: ProcessingDependencies = {
      jobStore,
      artifacts,
      audioExtractor: new AudioExtractionService(),
      transcriber: new TranscriptionService({
        executablePath: process.execPath,
        scriptPath: fakeWhisperPath,
        environment: {
          ...process.env,
          HUGGING_FACE_TOKEN: 'sentinel-hf-token',
          FAKE_WHISPER_MODE: 'success',
          FAKE_WHISPER_PROTOCOL_PATH: path.join(root, 'whisper-protocol.json'),
          FAKE_WHISPER_TRANSCRIPT_CANARY: TRANSCRIPT,
        },
      }),
    };
    let processing: Promise<void> | undefined;
    const jobQueue = {
      push(input: QueueInput) {
        processing = processMeetingJob(input, processingDependencies);
      },
    };
    const app = buildServer({
      apiKey: API_KEY,
      dependencies: { artifacts, jobQueue, jobStore },
    });
    cleanup.push(() => app.close());
    await app.ready();

    const form = new FormData();
    form.append('file', fs.readFileSync(fixturePath), {
      filename: 'short-recording.wav',
      contentType: 'audio/wav',
    });
    const accepted = await app.inject({
      method: 'POST',
      url: '/jobs',
      headers: {
        ...form.getHeaders(),
        'x-api-key': API_KEY,
        'x-job-id': JOB_ID,
        'x-recorded-at': '2026-08-20T12:00:00.000Z',
      },
      payload: form.getBuffer(),
    });

    expect(accepted.statusCode).toBe(200);
    await processing;

    const status = await app.inject({
      method: 'GET',
      url: `/jobs/${JOB_ID}`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      id: JOB_ID,
      serverStatus: 'COMPLETED',
      currentStep: JobStep.TRANSCRIPT_READY,
      steps: {
        [JobStep.QUEUED]: {
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        },
        [JobStep.EXTRACTING_AUDIO]: {
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        },
        [JobStep.TRANSCRIBING]: {
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        },
        [JobStep.TRANSCRIPT_READY]: {
          startedAt: expect.any(String),
          completedAt: expect.any(String),
        },
      },
    });

    const audioPath = artifacts.getAudioPath(JOB_ID, 'short-recording.wav');
    const probe = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_name,sample_rate,channels',
      '-of', 'json',
      audioPath,
    ]);
    expect(JSON.parse(probe.stdout).streams).toEqual([{
      codec_name: 'pcm_s16le',
      sample_rate: '16000',
      channels: 1,
    }]);

    const transcript = await app.inject({
      method: 'GET',
      url: `/jobs/${JOB_ID}/transcript`,
      headers: { 'x-api-key': API_KEY },
    });
    expect(transcript.statusCode).toBe(200);
    expect(transcript.headers['content-type']).toContain('text/plain');
    expect(transcript.body).toBe(TRANSCRIPT);
  }, 60_000);
});
