import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import type { JobRecord } from '../../src/domain/models';
import { buildServer } from '../../src/index';
import {
  createInitialSteps,
  processMeetingJob,
  type ProcessingDependencies,
} from '../../src/services/queue';

const API_KEY = 'lifecycle-api-key';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

describe('Authenticated processing lifecycle', () => {
  const apps: Array<ReturnType<typeof buildServer>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('exposes queued, extracting, transcribing, and Transcript-ready states live', async () => {
    const job: JobRecord = {
      id: 'live-lifecycle-job',
      originalFilename: 'Recording.wav',
      filePath: '/artifacts/accepted Recording.wav',
      serverStatus: 'PENDING',
      recordedAt: '2026-08-20T12:00:00.000Z',
      currentStep: JobStep.QUEUED,
      steps: createInitialSteps(),
    };
    const extractionGate = deferred();
    const transcriptionGate = deferred();
    const extractionEntered = deferred();
    const transcriptionEntered = deferred();
    const jobStore = {
      getAll: vi.fn(async () => [job]),
      getById: vi.fn(async (id: string) => id === job.id ? job : undefined),
      replace: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const dependencies: ProcessingDependencies = {
      jobStore,
      artifacts: {
        getAudioPath: vi.fn(() => '/artifacts/exact audio.wav'),
        getTranscriptPath: vi.fn(() => '/artifacts/exact Transcript.txt'),
        fileExists: vi.fn(async () => true),
      },
      audioExtractor: {
        convertToWav: vi.fn(async () => {
          extractionEntered.resolve();
          await extractionGate.promise;
          return { audioPath: '/artifacts/exact audio.wav' };
        }),
      },
      transcriber: {
        transcribe: vi.fn(async () => {
          transcriptionEntered.resolve();
          await transcriptionGate.promise;
          return { outputFilePath: '/artifacts/exact Transcript.txt' };
        }),
      },
    };
    const app = buildServer({
      apiKey: API_KEY,
      dependencies: {
        artifacts: {
          root: '/artifacts',
          ...dependencies.artifacts,
          getUploadPath: vi.fn(),
          getSummaryPath: vi.fn(),
          ensureDirectories: vi.fn(),
          stageRecording: vi.fn(),
          commitRecording: vi.fn(),
          deleteRecording: vi.fn(),
          readTranscript: vi.fn(),
          readSummary: vi.fn(),
          deleteJobFiles: vi.fn(),
        } as any,
        jobQueue: { push: vi.fn() },
        jobStore,
      },
    });
    apps.push(app);
    await app.ready();

    const status = async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/jobs/${job.id}`,
        headers: { 'x-api-key': API_KEY },
      });
      expect(response.statusCode).toBe(200);
      return response.json();
    };

    expect(await status()).toMatchObject({
      serverStatus: 'PENDING',
      currentStep: JobStep.QUEUED,
    });

    const processing = processMeetingJob(
      { jobId: job.id, filePath: job.filePath },
      dependencies,
    );
    await extractionEntered.promise;
    expect(await status()).toMatchObject({
      serverStatus: 'PROCESSING',
      currentStep: JobStep.EXTRACTING_AUDIO,
    });

    extractionGate.resolve();
    await transcriptionEntered.promise;
    expect(await status()).toMatchObject({
      serverStatus: 'PROCESSING',
      currentStep: JobStep.TRANSCRIBING,
    });

    transcriptionGate.resolve();
    await processing;
    expect(await status()).toMatchObject({
      serverStatus: 'COMPLETED',
      currentStep: JobStep.TRANSCRIPT_READY,
    });
  });
});
