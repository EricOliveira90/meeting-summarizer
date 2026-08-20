import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import { JobRecord } from '../../src/domain/models';

// Mock external dependencies
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {}
    models = { generateContent: vi.fn().mockResolvedValue({ text: 'Mock Summary' }) };
  }
}));

const { mockQueuePush } = vi.hoisted(() => ({
  mockQueuePush: vi.fn(),
}));

vi.mock('better-queue', () => ({
  default: class MockQueue {
    push = mockQueuePush;
    destroy = vi.fn();
  }
}));

// Mock the DB
const mockJobs: JobRecord[] = [];
const mockWrite = vi.fn();
vi.mock('../../src/services/db', () => ({
  getDb: () => Promise.resolve({
    data: { jobs: mockJobs },
    read: vi.fn(),
    write: mockWrite,
  }),
  jobStore: {
    getAll: () => Promise.resolve(mockJobs),
    getById: (id: string) => Promise.resolve(mockJobs.find((job) => job.id === id)),
    replace: vi.fn(),
    delete: vi.fn(),
  },
}));

import { buildServer } from '../../src/index';

function makeFailedJob(id: string): JobRecord {
  return {
    id,
    originalFilename: `${id}.mkv`,
    filePath: `/uploads/${id}.mkv`,
    serverStatus: 'FAILED',
    recordedAt: new Date().toISOString(),
    currentStep: JobStep.TRANSCRIBING,
    failedStep: JobStep.TRANSCRIBING,
    error: 'Whisper crashed',
    steps: {
      [JobStep.QUEUED]: { startedAt: '2024-01-01T00:00:00Z', completedAt: '2024-01-01T00:00:00Z' },
      [JobStep.EXTRACTING_AUDIO]: { startedAt: '2024-01-01T00:00:01Z', completedAt: '2024-01-01T00:00:02Z' },
      [JobStep.TRANSCRIBING]: { startedAt: '2024-01-01T00:00:03Z' },
    },
  };
}

describe('POST /jobs/:id/retry — Job Retry API', () => {
  const apiKey = 'test-api-key';
  const app = buildServer({ apiKey });

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    mockJobs.length = 0;
    vi.clearAllMocks();
  });

  it('returns 404 for unknown job', async () => {
    const response = await app.inject({ method: 'POST', url: '/jobs/nonexistent/retry', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Job not found' });
  });

  it('returns 409 for non-FAILED job', async () => {
    mockJobs.push({
      id: 'job-ok',
      originalFilename: 'test.mkv',
      filePath: '/uploads/test.mkv',
      serverStatus: 'COMPLETED',
      recordedAt: new Date().toISOString(),
      currentStep: JobStep.DONE,
    });

    const response = await app.inject({ method: 'POST', url: '/jobs/job-ok/retry', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: 'Only FAILED jobs can be retried' });
  });

  it('retries a FAILED job — resets status to PENDING and clears error', async () => {
    mockJobs.push(makeFailedJob('job-retry'));

    const response = await app.inject({ method: 'POST', url: '/jobs/job-retry/retry', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, message: 'Job re-queued' });

    const job = mockJobs.find(j => j.id === 'job-retry')!;
    expect(job.serverStatus).toBe('PENDING');
    expect(job.error).toBeUndefined();
    expect(job.failedStep).toBeUndefined();
  });

  it('retries a FAILED job — preserves completed step timestamps', async () => {
    mockJobs.push(makeFailedJob('job-retry-steps'));

    await app.inject({ method: 'POST', url: '/jobs/job-retry-steps/retry', headers: { 'x-api-key': apiKey } });

    const job = mockJobs.find(j => j.id === 'job-retry-steps')!;
    // Completed steps should be preserved
    expect(job.steps![JobStep.EXTRACTING_AUDIO]?.completedAt).toBeDefined();
    // Incomplete step timestamps should be cleared
    expect(job.steps![JobStep.TRANSCRIBING]?.startedAt).toBeUndefined();
  });

  it('retries a FAILED job — re-queues the job', async () => {
    mockJobs.push(makeFailedJob('job-requeue'));

    await app.inject({ method: 'POST', url: '/jobs/job-requeue/retry', headers: { 'x-api-key': apiKey } });

    expect(mockQueuePush).toHaveBeenCalledWith({
      jobId: 'job-requeue',
      filePath: '/uploads/job-requeue.mkv',
    });
  });
});
