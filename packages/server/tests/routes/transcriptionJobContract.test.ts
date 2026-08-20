import { Readable } from 'node:stream';
import FormData from 'form-data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobStep } from '@meeting-summarizer/shared';
import type { JobRecord } from '../../src/domain/models';

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

import { buildServer } from '../../src/index';

const API_KEY = 'contract-test-key';
const openApps: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

function multipartRecording(content: Buffer, filename: string, contentType: string) {
  const form = new FormData();
  form.append('file', content, { filename, contentType });
  return {
    payload: form.getBuffer(),
    headers: form.getHeaders(),
  };
}

function createHarness() {
  const jobs: JobRecord[] = [];
  const effects: string[] = [];

  const jobStore = {
    getAll: vi.fn(async () => jobs),
    getById: vi.fn(async (id: string) => jobs.find((job) => job.id === id)),
    replace: vi.fn(async (job: JobRecord) => {
      effects.push('persist');
      const index = jobs.findIndex((candidate) => candidate.id === job.id);
      if (index === -1) jobs.push(job);
      else jobs[index] = job;
    }),
    delete: vi.fn(async (id: string) => {
      const index = jobs.findIndex((job) => job.id === id);
      if (index !== -1) jobs.splice(index, 1);
    }),
  };

  const artifacts = {
    root: '/artifact-root',
    getUploadPath: vi.fn((jobId: string, filename: string) => {
      effects.push('path');
      return `/artifact-root/uploads/${jobId}_${filename}`;
    }),
    getAudioPath: vi.fn(() => '/artifact-root/audio'),
    getTranscriptPath: vi.fn(() => '/artifact-root/transcript'),
    getSummaryPath: vi.fn(() => '/artifact-root/summary'),
    ensureDirectories: vi.fn(async () => {}),
    stageRecording: vi.fn(async (_path: string, stream: Readable) => {
      effects.push('stage');
      let size = 0;
      for await (const chunk of stream) size += Buffer.byteLength(chunk);
      return { stagedPath: '/artifact-root/staged-recording', size };
    }),
    commitRecording: vi.fn(async () => {
      effects.push('commit');
    }),
    deleteRecording: vi.fn(async () => {
      effects.push('delete');
    }),
    fileExists: vi.fn(async () => false),
    readTranscript: vi.fn(async () => null),
    readSummary: vi.fn(async () => null),
    deleteJobFiles: vi.fn(async () => {}),
  };

  const jobQueue = {
    push: vi.fn(() => {
      effects.push('queue');
    }),
  };

  const app = buildServer({
    apiKey: API_KEY,
    dependencies: { jobStore, jobQueue, artifacts },
  });
  openApps.push(app);

  return { app, artifacts, effects, jobQueue, jobs, jobStore };
}

describe.each(['/jobs', '/upload'])('POST %s creation contract', (url) => {
  it('stages, commits, persists, and queues one Recording through the shared path', async () => {
    const harness = createHarness();
    const multipart = multipartRecording(Buffer.from('recording'), 'meeting.wav', 'audio/wav');

    const response = await harness.app.inject({
      method: 'POST',
      url,
      headers: {
        ...multipart.headers,
        'x-api-key': API_KEY,
        'x-job-id': 'job-123',
        'x-recorded-at': '2026-04-01T07:30:00-03:00',
      },
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      jobId: 'job-123',
      message: 'File queued.',
    });
    expect(harness.jobs).toEqual([
      expect.objectContaining({
        id: 'job-123',
        originalFilename: 'meeting.wav',
        filePath: '/artifact-root/uploads/job-123_meeting.wav',
        recordedAt: '2026-04-01T10:30:00.000Z',
        serverStatus: 'PENDING',
        currentStep: JobStep.QUEUED,
        options: {
          language: 'auto',
          template: 'meeting',
        },
      }),
    ]);
    expect(harness.artifacts.commitRecording).toHaveBeenCalledOnce();
    expect(harness.jobStore.replace).toHaveBeenCalledOnce();
    expect(harness.jobQueue.push).toHaveBeenCalledWith({
      jobId: 'job-123',
      filePath: '/artifact-root/uploads/job-123_meeting.wav',
    });
    expect(harness.effects).toEqual(['path', 'stage', 'commit', 'persist', 'queue']);
  });

  const invalidMetadata = [
    {
      name: 'missing Job ID',
      omit: ['x-job-id'],
      expected: {
        code: 'INVALID_JOB_ID',
        error: 'x-job-id must contain 1-128 letters, digits, hyphens, or underscores and start with a letter or digit.',
      },
    },
    ...['_job', 'job.1', '../job', 'a'.repeat(129)].map((value) => ({
      name: `Job ID ${value}`,
      headers: { 'x-job-id': value },
      expected: {
        code: 'INVALID_JOB_ID',
        error: 'x-job-id must contain 1-128 letters, digits, hyphens, or underscores and start with a letter or digit.',
      },
    })),
    {
      name: 'missing recorded-at',
      omit: ['x-recorded-at'],
      expected: {
        code: 'INVALID_RECORDED_AT',
        error: 'x-recorded-at must be a valid ISO-8601 timestamp.',
      },
    },
    ...[
      '2026-04-01T10:30:00',
      '2026-04-01',
      '2026-W14-3T10:30:00Z',
      '2026-091T10:30:00Z',
      '2026-04-01T10:30:60Z',
      '2026-02-30T10:30:00Z',
      'not-a-date',
    ].map((value) => ({
      name: `recorded-at ${value}`,
      headers: { 'x-recorded-at': value },
      expected: {
        code: 'INVALID_RECORDED_AT',
        error: 'x-recorded-at must be a valid ISO-8601 timestamp.',
      },
    })),
    {
      name: 'unknown language',
      headers: { 'x-language': 'fr' },
      expected: {
        code: 'INVALID_LANGUAGE',
        error: 'x-language must be one of: auto, en, pt, es.',
      },
    },
    {
      name: 'unknown template',
      headers: { 'x-template': 'minutes' },
      expected: {
        code: 'INVALID_TEMPLATE',
        error: 'x-template must be one of: meeting, training, summary.',
      },
    },
    ...['x-min-speakers', 'x-max-speakers'].flatMap((header) =>
      ['0', '-1', '1.5', '2x'].map((value) => ({
        name: `${header} ${value}`,
        headers: { [header]: value },
        expected: {
          code: 'INVALID_SPEAKER_BOUND',
          error: 'Speaker bounds must be positive integers.',
        },
      })),
    ),
    {
      name: 'descending speaker range',
      headers: { 'x-min-speakers': '3', 'x-max-speakers': '2' },
      expected: {
        code: 'INVALID_SPEAKER_RANGE',
        error: 'x-min-speakers must not exceed x-max-speakers.',
      },
    },
  ];

  it.each(invalidMetadata)('rejects $name before collaborator effects', async ({ headers = {}, omit = [], expected }) => {
    const harness = createHarness();
    const multipart = multipartRecording(Buffer.from('recording'), 'meeting.wav', 'audio/wav');
    const requestHeaders: Record<string, string> = {
      ...multipart.headers,
      'x-api-key': API_KEY,
      'x-job-id': 'job-123',
      'x-recorded-at': '2026-04-01T10:30:00Z',
      ...headers,
    };
    for (const header of omit) delete requestHeaders[header];

    const response = await harness.app.inject({
      method: 'POST',
      url,
      headers: requestHeaders,
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expected);
    expect(harness.effects).toEqual([]);
  });
});
