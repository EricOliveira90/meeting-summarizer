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
    delete: vi.fn(async (id: string) => {
      const index = mockJobs.findIndex((job) => job.id === id);
      if (index !== -1) mockJobs.splice(index, 1);
      await mockWrite();
    }),
  },
}));

// Mock file manager's deleteJobFiles
const mockDeleteJobFiles = vi.fn();
vi.mock('../../src/services/file-manager', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    FileManagerService: class extends original.FileManagerService {
      async deleteJobFiles(...args: any[]) {
        return mockDeleteJobFiles(...args);
      }
    }
  };
});

import { buildServer } from '../../src/index';
import { activeProcess, setActiveProcess } from '../../src/services/queue';

function makeJob(id: string, status: JobRecord['serverStatus']): JobRecord {
  return {
    id,
    originalFilename: `${id}.mkv`,
    filePath: `/uploads/${id}.mkv`,
    serverStatus: status,
    recordedAt: new Date().toISOString(),
    currentStep: status === 'COMPLETED' ? JobStep.TRANSCRIPT_READY : JobStep.QUEUED,
  };
}

describe('DELETE /jobs/:id — Job Deletion API', () => {
  const apiKey = 'test-api-key';
  const app = buildServer({ apiKey });

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(() => {
    mockJobs.length = 0;
    vi.clearAllMocks();
    setActiveProcess(null);
  });

  it('returns 404 for unknown job', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/jobs/nonexistent', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'JOB_NOT_FOUND',
      error: 'Job was not found.',
    });
  });

  it('deletes a PENDING job — removes DB record and files', async () => {
    mockJobs.push(makeJob('job-pending', 'PENDING'));

    const response = await app.inject({ method: 'DELETE', url: '/jobs/job-pending', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, message: 'Job deleted' });

    // DB record should be removed
    expect(mockJobs.find(j => j.id === 'job-pending')).toBeUndefined();
    expect(mockWrite).toHaveBeenCalled();
  });

  it('deletes a COMPLETED job — removes DB record and files', async () => {
    mockJobs.push(makeJob('job-done', 'COMPLETED'));

    const response = await app.inject({ method: 'DELETE', url: '/jobs/job-done', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(200);

    expect(mockJobs.find(j => j.id === 'job-done')).toBeUndefined();
  });

  it('deletes a FAILED job — removes DB record and files', async () => {
    mockJobs.push(makeJob('job-fail', 'FAILED'));

    const response = await app.inject({ method: 'DELETE', url: '/jobs/job-fail', headers: { 'x-api-key': apiKey } });
    expect(response.statusCode).toBe(200);

    expect(mockJobs.find(j => j.id === 'job-fail')).toBeUndefined();
  });

  it('deletes a PROCESSING job by cancelling its process, files, and record', async () => {
    const process = { kill: vi.fn() };
    setActiveProcess(process);
    mockJobs.push(makeJob('job-processing', 'PROCESSING'));

    const response = await app.inject({
      method: 'DELETE',
      url: '/jobs/job-processing',
      headers: { 'x-api-key': apiKey },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, message: 'Job deleted' });
    expect(process.kill).toHaveBeenCalledOnce();
    expect(activeProcess).toBeNull();
    expect(mockDeleteJobFiles).toHaveBeenCalledWith('job-processing', 'job-processing.mkv');
    expect(mockJobs).toEqual([]);
    expect(mockWrite).toHaveBeenCalledOnce();
  });
});
