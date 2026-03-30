import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import { JobRecord } from '../../src/domain/models';
import { recoverStalledJobs } from '../../src/services/recovery';

const mockJobs: JobRecord[] = [];
const mockWrite = vi.fn();
const mockQueuePush = vi.fn();
const mockFileExists = vi.fn();

vi.mock('../../src/services/db', () => ({
  getDb: () => Promise.resolve({
    data: { jobs: mockJobs },
    read: vi.fn(),
    write: mockWrite,
  }),
}));

function makeProcessingJob(id: string, recoveryAttempts: number, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id,
    originalFilename: `${id}.mkv`,
    filePath: `/uploads/${id}.mkv`,
    serverStatus: 'PROCESSING',
    recordedAt: new Date().toISOString(),
    currentStep: JobStep.TRANSCRIBING,
    recoveryAttempts,
    steps: {
      [JobStep.QUEUED]: { startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:00:00Z' },
      [JobStep.EXTRACTING_AUDIO]: { startedAt: '2024-01-01T00:00:01Z', completedAt: '2024-01-01T00:00:02Z' },
    },
    ...overrides,
  };
}

describe('Startup Recovery — 3-Strike Escalation', () => {
  beforeEach(() => {
    mockJobs.length = 0;
    vi.clearAllMocks();
    mockFileExists.mockResolvedValue(false);
  });

  it('re-queues stalled job with recoveryAttempts=0 from last completed step', async () => {
    mockJobs.push(makeProcessingJob('job-stalled-0', 0));

    // Audio file exists (step completed), transcript does not
    mockFileExists.mockImplementation((path: string) => {
      if (path.includes('audio_cache')) return Promise.resolve(true);
      return Promise.resolve(false);
    });

    await recoverStalledJobs(mockQueuePush, {
      fileExists: mockFileExists,
      getAudioPath: (id: string, fn: string) => `/audio_cache/${id}_${fn}.wav`,
      getTranscriptPath: (id: string) => `/transcriptions/${id}_transcript.txt`,
      getSummaryPath: (id: string) => `/summaries/${id}_summary.txt`,
    });

    const job = mockJobs.find(j => j.id === 'job-stalled-0')!;
    expect(job.recoveryAttempts).toBe(1);
    expect(job.serverStatus).toBe('PENDING');
    expect(mockQueuePush).toHaveBeenCalledWith({
      jobId: 'job-stalled-0',
      filePath: '/uploads/job-stalled-0.mkv',
    });
  });

  it('re-queues stalled job with recoveryAttempts=1 from scratch', async () => {
    mockJobs.push(makeProcessingJob('job-stalled-1', 1));

    await recoverStalledJobs(mockQueuePush, {
      fileExists: mockFileExists,
      getAudioPath: (id: string, fn: string) => `/audio_cache/${id}_${fn}.wav`,
      getTranscriptPath: (id: string) => `/transcriptions/${id}_transcript.txt`,
      getSummaryPath: (id: string) => `/summaries/${id}_summary.txt`,
    });

    const job = mockJobs.find(j => j.id === 'job-stalled-1')!;
    expect(job.recoveryAttempts).toBe(2);
    expect(job.serverStatus).toBe('PENDING');
    expect(mockQueuePush).toHaveBeenCalled();
  });

  it('marks stalled job with recoveryAttempts>=2 as FAILED', async () => {
    mockJobs.push(makeProcessingJob('job-stalled-2', 2));

    await recoverStalledJobs(mockQueuePush, {
      fileExists: mockFileExists,
      getAudioPath: (id: string, fn: string) => `/audio_cache/${id}_${fn}.wav`,
      getTranscriptPath: (id: string) => `/transcriptions/${id}_transcript.txt`,
      getSummaryPath: (id: string) => `/summaries/${id}_summary.txt`,
    });

    const job = mockJobs.find(j => j.id === 'job-stalled-2')!;
    expect(job.serverStatus).toBe('FAILED');
    expect(job.error).toBe('Max recovery attempts exceeded');
    expect(mockQueuePush).not.toHaveBeenCalled();
  });

  it('does not touch non-PROCESSING jobs', async () => {
    mockJobs.push({
      id: 'job-completed',
      originalFilename: 'test.mkv',
      filePath: '/uploads/test.mkv',
      serverStatus: 'COMPLETED',
      recordedAt: new Date().toISOString(),
      currentStep: JobStep.DONE,
      recoveryAttempts: 0,
    });

    await recoverStalledJobs(mockQueuePush, {
      fileExists: mockFileExists,
      getAudioPath: (id: string, fn: string) => `/audio_cache/${id}_${fn}.wav`,
      getTranscriptPath: (id: string) => `/transcriptions/${id}_transcript.txt`,
      getSummaryPath: (id: string) => `/summaries/${id}_summary.txt`,
    });

    expect(mockJobs[0].serverStatus).toBe('COMPLETED');
    expect(mockQueuePush).not.toHaveBeenCalled();
  });
});
