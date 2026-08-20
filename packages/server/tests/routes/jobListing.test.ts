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

vi.mock('better-queue', () => ({
  default: class MockQueue {
    push = vi.fn();
    destroy = vi.fn();
  }
}));

// Mock the DB
const mockJobs: JobRecord[] = [];
vi.mock('../../src/services/db', () => ({
  getDb: () => Promise.resolve({
    data: { jobs: mockJobs },
    read: vi.fn(),
    write: vi.fn(),
  }),
  jobStore: {
    getAll: () => Promise.resolve(mockJobs),
    getById: (id: string) => Promise.resolve(mockJobs.find((job) => job.id === id)),
    replace: vi.fn(),
    delete: vi.fn(),
  },
}));

import { buildServer } from '../../src/index';

function makeJob(id: string, status: JobRecord['serverStatus']): JobRecord {
  return {
    id,
    originalFilename: `${id}.mkv`,
    filePath: `/uploads/${id}.mkv`,
    serverStatus: status,
    recordedAt: new Date().toISOString(),
    currentStep: status === 'COMPLETED' ? JobStep.DONE : JobStep.QUEUED,
  };
}

describe('GET /jobs — Job Listing API', () => {
  const apiKey = 'test-api-key';
  const app = buildServer({ apiKey });

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    mockJobs.length = 0;
  });

  it('returns paginated results with correct total, page, limit', async () => {
    for (let i = 0; i < 5; i++) {
      mockJobs.push(makeJob(`job-${i}`, 'COMPLETED'));
    }

    const response = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.total).toBe(5);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.jobs).toHaveLength(5);
  });

  it('returns correct page offset with page=2&limit=2', async () => {
    for (let i = 0; i < 5; i++) {
      mockJobs.push(makeJob(`job-${i}`, 'COMPLETED'));
    }

    const response = await app.inject({ method: 'GET', url: '/jobs?page=2&limit=2', headers: { 'x-api-key': apiKey } });
    const body = response.json();

    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.total).toBe(5);
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs[0].id).toBe('job-2');
    expect(body.jobs[1].id).toBe('job-3');
  });

  it('filters by status=FAILED', async () => {
    mockJobs.push(makeJob('job-ok', 'COMPLETED'));
    mockJobs.push(makeJob('job-fail-1', 'FAILED'));
    mockJobs.push(makeJob('job-fail-2', 'FAILED'));

    const response = await app.inject({ method: 'GET', url: '/jobs?status=FAILED', headers: { 'x-api-key': apiKey } });
    const body = response.json();

    expect(body.total).toBe(2);
    expect(body.jobs).toHaveLength(2);
    expect(body.jobs.every((j: any) => j.serverStatus === 'FAILED')).toBe(true);
  });

  it('returns empty results when no jobs match', async () => {
    const response = await app.inject({ method: 'GET', url: '/jobs?status=FAILED', headers: { 'x-api-key': apiKey } });
    const body = response.json();

    expect(body.total).toBe(0);
    expect(body.jobs).toHaveLength(0);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it('defaults to page=1 and limit=20', async () => {
    const response = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-api-key': apiKey } });
    const body = response.json();

    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it('does not expose internal file paths in response', async () => {
    mockJobs.push(makeJob('job-secret', 'COMPLETED'));

    const response = await app.inject({ method: 'GET', url: '/jobs', headers: { 'x-api-key': apiKey } });
    const body = response.json();
    const job = body.jobs[0];

    expect(job.filePath).toBeUndefined();
    expect(job.audioPath).toBeUndefined();
    expect(job.transcriptPath).toBeUndefined();
    expect(job.summaryPath).toBeUndefined();
  });
});
