import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import { JobRecord } from '../../src/domain/models';
import { processMeetingJob, createInitialSteps } from '../../src/services/queue';

// Mock the external services
const mockConvertToWav = vi.fn();
const mockTranscribe = vi.fn();
const mockSummarize = vi.fn();

const mockDb = {
  data: { jobs: [] as JobRecord[] },
  read: vi.fn(),
  write: vi.fn(),
};

vi.mock('../../src/services', () => ({
  audioExtractionService: { convertToWav: (...args: any[]) => mockConvertToWav(...args) },
  transcriptionService: { transcribe: (...args: any[]) => mockTranscribe(...args) },
  summaryService: { summarize: (...args: any[]) => mockSummarize(...args) },
  getDb: () => Promise.resolve(mockDb),
  FileManagerService: class {},
}));

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

describe('Queue Processor — Step Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.data.jobs = [];
  });

  it('initializes steps with QUEUED timestamps on job creation', () => {
    const steps = createInitialSteps();
    expect(steps[JobStep.QUEUED]).toBeDefined();
    expect(steps[JobStep.QUEUED]!.startedAt).toBeDefined();
    expect(steps[JobStep.QUEUED]!.completedAt).toBeDefined();
  });

  it('completes the server operation when the Transcript is ready without running a Summary step', async () => {
    const job = makeJob();
    mockDb.data.jobs = [job];

    mockConvertToWav.mockResolvedValue({ audioPath: '/audio/test.wav' });
    mockTranscribe.mockResolvedValue({ text: 'hello', outputFilePath: '/trans/test.txt' });

    await processMeetingJob({ jobId: 'test-job', filePath: '/uploads/test.mkv' });

    const updatedJob = mockDb.data.jobs[0];
    expect(updatedJob.serverStatus).toBe('COMPLETED');
    expect(updatedJob.currentStep).toBe(JobStep.TRANSCRIPT_READY);
    expect(updatedJob.steps![JobStep.EXTRACTING_AUDIO]?.startedAt).toBeDefined();
    expect(updatedJob.steps![JobStep.EXTRACTING_AUDIO]?.completedAt).toBeDefined();
    expect(updatedJob.steps![JobStep.TRANSCRIBING]?.startedAt).toBeDefined();
    expect(updatedJob.steps![JobStep.TRANSCRIBING]?.completedAt).toBeDefined();
    expect(updatedJob.steps![JobStep.TRANSCRIPT_READY]?.startedAt).toBeDefined();
    expect(updatedJob.steps![JobStep.TRANSCRIPT_READY]?.completedAt).toBeDefined();
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('sets failedStep when processing fails at a specific step', async () => {
    const job = makeJob();
    mockDb.data.jobs = [job];

    mockConvertToWav.mockResolvedValue({ audioPath: '/audio/test.wav' });
    mockTranscribe.mockRejectedValue(new Error('Whisper crashed'));

    await expect(
      processMeetingJob({ jobId: 'test-job', filePath: '/uploads/test.mkv' })
    ).rejects.toThrow('Whisper crashed');

    const updatedJob = mockDb.data.jobs[0];
    expect(updatedJob.serverStatus).toBe('FAILED');
    expect(updatedJob.failedStep).toBe(JobStep.TRANSCRIBING);
    expect(updatedJob.error).toBe('Whisper crashed');
  });

  it('resets recoveryAttempts to 0 on successful completion', async () => {
    const job = makeJob({ recoveryAttempts: 2 });
    mockDb.data.jobs = [job];

    mockConvertToWav.mockResolvedValue({ audioPath: '/audio/test.wav' });
    mockTranscribe.mockResolvedValue({ text: 'hello', outputFilePath: '/trans/test.txt' });
    await processMeetingJob({ jobId: 'test-job', filePath: '/uploads/test.mkv' });

    expect(mockDb.data.jobs[0].recoveryAttempts).toBe(0);
  });
});
