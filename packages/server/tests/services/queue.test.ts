import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import type { JobRecord } from '../../src/domain/models';
import {
  createMeetingQueue,
  createInitialSteps,
  processMeetingJob,
  type ProcessingDependencies,
} from '../../src/services/queue';

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'test-job',
    originalFilename: 'test.mkv',
    filePath: '/uploads/test.mkv',
    serverStatus: 'PENDING',
    recordedAt: new Date().toISOString(),
    currentStep: JobStep.QUEUED,
    steps: createInitialSteps(),
    ...overrides,
  };
}

function createHarness(overrides: {
  job?: JobRecord;
  audioPath?: string;
  transcriptPath?: string;
  transcriptExists?: boolean;
} = {}) {
  const job = overrides.job ?? makeJob();
  const audioPath = overrides.audioPath ?? '/audio/test.wav';
  const transcriptPath = overrides.transcriptPath ?? '/transcripts/test.txt';
  const extract = vi.fn().mockResolvedValue({ audioPath });
  const transcribe = vi.fn().mockResolvedValue({
    text: 'hello',
    outputFilePath: transcriptPath,
  });
  const replace = vi.fn().mockResolvedValue(undefined);
  const fileExists = vi.fn().mockResolvedValue(overrides.transcriptExists ?? true);
  const dependencies: ProcessingDependencies = {
    jobStore: {
      getById: vi.fn(async (id: string) => id === job.id ? job : undefined),
      replace,
    },
    artifacts: {
      getAudioPath: vi.fn().mockReturnValue(audioPath),
      getTranscriptPath: vi.fn().mockReturnValue(transcriptPath),
      fileExists,
    },
    audioExtractor: { convertToWav: extract },
    transcriber: { transcribe },
  };

  return {
    audioPath,
    dependencies,
    extract,
    fileExists,
    job,
    transcriptPath,
    transcribe,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

describe('Queue Processor - Step Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes steps with QUEUED timestamps on job creation', () => {
    const steps = createInitialSteps();
    expect(steps[JobStep.QUEUED]).toBeDefined();
    expect(steps[JobStep.QUEUED]!.startedAt).toBeDefined();
    expect(steps[JobStep.QUEUED]!.completedAt).toBeDefined();
  });

  it('completes the server operation when the Transcript is ready without a Summary step', async () => {
    const harness = createHarness();

    await processMeetingJob(
      { jobId: harness.job.id, filePath: harness.job.filePath },
      harness.dependencies,
    );

    expect(harness.job.serverStatus).toBe('COMPLETED');
    expect(harness.job.currentStep).toBe(JobStep.TRANSCRIPT_READY);
    expect(Object.keys(harness.job.steps!)).toEqual([
      JobStep.QUEUED,
      JobStep.EXTRACTING_AUDIO,
      JobStep.TRANSCRIBING,
      JobStep.TRANSCRIPT_READY,
    ]);

    const orderedSteps = [
      JobStep.QUEUED,
      JobStep.EXTRACTING_AUDIO,
      JobStep.TRANSCRIBING,
      JobStep.TRANSCRIPT_READY,
    ];
    for (let index = 1; index < orderedSteps.length; index += 1) {
      const previous = harness.job.steps![orderedSteps[index - 1]]!;
      const current = harness.job.steps![orderedSteps[index]]!;
      expect(Date.parse(previous.completedAt!)).toBeLessThanOrEqual(
        Date.parse(current.startedAt),
      );
    }
  });

  it('attributes an extraction failure to the active step', async () => {
    const harness = createHarness();
    harness.extract.mockRejectedValueOnce(new Error('FFmpeg crashed'));

    await expect(processMeetingJob(
      { jobId: harness.job.id, filePath: harness.job.filePath },
      harness.dependencies,
    )).rejects.toThrow('FFmpeg crashed');

    expect(harness.job.serverStatus).toBe('FAILED');
    expect(harness.job.failedStep).toBe(JobStep.EXTRACTING_AUDIO);
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it('attributes a transcription failure to the active step', async () => {
    const harness = createHarness();
    harness.transcribe.mockRejectedValueOnce(new Error('Whisper crashed'));

    await expect(processMeetingJob(
      { jobId: harness.job.id, filePath: harness.job.filePath },
      harness.dependencies,
    )).rejects.toThrow('Whisper crashed');

    expect(harness.job.serverStatus).toBe('FAILED');
    expect(harness.job.failedStep).toBe(JobStep.TRANSCRIBING);
    expect(harness.job.error).toBe('Whisper crashed');
  });

  it('resets recoveryAttempts to 0 on successful completion', async () => {
    const harness = createHarness({ job: makeJob({ recoveryAttempts: 2 }) });

    await processMeetingJob(
      { jobId: harness.job.id, filePath: harness.job.filePath },
      harness.dependencies,
    );

    expect(harness.job.recoveryAttempts).toBe(0);
  });

  it('passes injected artifact paths unchanged through processing and readiness verification', async () => {
    const uploadPath = 'Z:\\sentinel root\\accepted Recording.bin';
    const audioPath = 'Y:\\unrelated audio\\authoritative.wav';
    const transcriptPath = 'X:\\other Transcript root\\authoritative.txt';
    const harness = createHarness({
      job: makeJob({ filePath: uploadPath }),
      audioPath,
      transcriptPath,
    });

    await processMeetingJob(
      { jobId: harness.job.id, filePath: uploadPath },
      harness.dependencies,
    );

    expect(harness.extract).toHaveBeenCalledWith(uploadPath, audioPath);
    expect(harness.transcribe).toHaveBeenCalledWith(
      audioPath,
      transcriptPath,
      expect.objectContaining({ language: 'auto' }),
    );
    expect(harness.fileExists).toHaveBeenCalledWith(transcriptPath);
    expect(harness.job.audioPath).toBe(audioPath);
    expect(harness.job.transcriptPath).toBe(transcriptPath);
  });
});

describe('Meeting queue serialization', () => {
  it('does not start a second queued Job while the first process adapter is blocked', async () => {
    const first = makeJob({ id: 'first', filePath: '/uploads/first.wav' });
    const second = makeJob({ id: 'second', filePath: '/uploads/second.wav' });
    const jobs = [first, second];
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const secondEntered = deferred();
    const secondCompleted = deferred();
    const dependencies: ProcessingDependencies = {
      jobStore: {
        getById: vi.fn(async (id: string) => jobs.find((job) => job.id === id)),
        replace: vi.fn(async (job: JobRecord) => {
          if (
            job.id === second.id &&
            job.currentStep === JobStep.TRANSCRIPT_READY &&
            job.serverStatus === 'COMPLETED'
          ) {
            secondCompleted.resolve();
          }
        }),
      },
      artifacts: {
        getAudioPath: vi.fn((id: string) => `/audio/${id}.wav`),
        getTranscriptPath: vi.fn((id: string) => `/transcripts/${id}.txt`),
        fileExists: vi.fn(async () => true),
      },
      audioExtractor: {
        convertToWav: vi.fn(async (inputPath: string, outputPath: string) => {
          if (inputPath === first.filePath) {
            firstEntered.resolve();
            await releaseFirst.promise;
          } else {
            secondEntered.resolve();
          }
          return { audioPath: outputPath };
        }),
      },
      transcriber: {
        transcribe: vi.fn(async (_audioPath: string, outputFilePath: string) => ({
          outputFilePath,
        })),
      },
    };
    const queue = createMeetingQueue(dependencies) as any;

    try {
      queue.push({ jobId: first.id, filePath: first.filePath });
      queue.push({ jobId: second.id, filePath: second.filePath });
      await firstEntered.promise;
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(second.serverStatus).toBe('PENDING');
      expect(second.currentStep).toBe(JobStep.QUEUED);
      expect(dependencies.audioExtractor.convertToWav).not.toHaveBeenCalledWith(
        second.filePath,
        expect.any(String),
      );

      releaseFirst.resolve();
      await secondEntered.promise;
      await secondCompleted.promise;
    } finally {
      await new Promise<void>((resolve) => queue.destroy(resolve));
    }
  }, 10_000);
});
