import { Readable } from 'node:stream';
import FormData from 'form-data';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIPromptTemplate, JobStep, TranscriptionLanguage } from '@meeting-summarizer/shared';
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

function createHarness({ stagedSize }: { stagedSize?: number } = {}) {
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
      return { stagedPath: '/artifact-root/staged-recording', size: stagedSize ?? size };
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

async function submitRecording(
  harness: ReturnType<typeof createHarness>,
  url: string,
  {
    content = Buffer.from('recording'),
    filename = 'meeting.wav',
    contentType = 'audio/wav',
    headers = {},
  }: {
    content?: Buffer;
    filename?: string;
    contentType?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const multipart = multipartRecording(content, filename, contentType);
  return harness.app.inject({
    method: 'POST',
    url,
    headers: {
      ...multipart.headers,
      'x-api-key': API_KEY,
      'x-job-id': 'job-123',
      'x-recorded-at': '2026-04-01T10:30:00Z',
      ...headers,
    },
    payload: multipart.payload,
  });
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

  const supportedMedia = [
    ['recording.mkv', 'video/x-matroska'],
    ['recording.mp3', 'audio/mpeg'],
    ['recording.opus', 'audio/ogg'],
    ['recording.m4a', 'audio/mp4'],
    ['recording.wav', 'audio/wav'],
  ] as const;
  const languages = ['auto', 'en', 'pt', 'es'] as const;

  it.each(
    supportedMedia.flatMap(([filename, contentType]) =>
      languages.map((language) => ({ filename, contentType, language })),
    ),
  )('accepts $filename/$contentType with language $language', async ({ filename, contentType, language }) => {
    const harness = createHarness();

    const response = await submitRecording(harness, url, {
      filename,
      contentType,
      headers: { 'x-language': language },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.jobs[0]).toEqual(expect.objectContaining({
      originalFilename: filename,
      options: {
        language,
        template: 'meeting',
      },
    }));
  });

  it.each([
    ['recording.flac', 'audio/flac'],
    ['recording.wav', 'audio/mpeg'],
  ])('rejects unsupported media pair %s/%s', async (filename, contentType) => {
    const harness = createHarness();

    const response = await submitRecording(harness, url, { filename, contentType });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Recording extension and MIME type are not a supported pair.',
    });
    expect(harness.effects).toEqual([]);
  });

  it.each([
    [undefined, 'meeting'],
    ['meeting', 'meeting'],
    ['training', 'training'],
    ['summary', 'summary'],
  ])('persists template header %s as %s', async (template, expected) => {
    const harness = createHarness();
    const headers = template === undefined ? {} : { 'x-template': template };

    const response = await submitRecording(harness, url, { headers });

    expect(response.statusCode).toBe(200);
    expect(harness.jobs[0].options?.template).toBe(expected);
  });

  it.each([
    [{}, { language: 'en', template: 'meeting' }],
    [{ 'x-min-speakers': '2' }, { language: 'en', template: 'meeting', minSpeakers: 2 }],
    [{ 'x-max-speakers': '5' }, { language: 'en', template: 'meeting', maxSpeakers: 5 }],
    [{ 'x-min-speakers': '3', 'x-max-speakers': '3' }, { language: 'en', template: 'meeting', minSpeakers: 3, maxSpeakers: 3 }],
    [{ 'x-min-speakers': '2', 'x-max-speakers': '5' }, { language: 'en', template: 'meeting', minSpeakers: 2, maxSpeakers: 5 }],
  ])('persists exact sparse speaker options for %j', async (speakerHeaders, expected) => {
    const harness = createHarness();

    const response = await submitRecording(harness, url, {
      headers: {
        'x-language': 'en',
        'x-template': 'meeting',
        ...speakerHeaders,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.jobs[0].options).toEqual(expected);
  });

  it.each([
    {
      name: 'one-character ID',
      headers: { 'x-job-id': 'a' },
      expectedId: 'a',
      expectedTime: '2026-04-01T10:30:00.000Z',
    },
    {
      name: '128-character ID',
      headers: { 'x-job-id': 'a'.repeat(128) },
      expectedId: 'a'.repeat(128),
      expectedTime: '2026-04-01T10:30:00.000Z',
    },
    {
      name: 'UTC timestamp',
      headers: { 'x-recorded-at': '2026-04-01T10:30:00Z' },
      expectedId: 'job-123',
      expectedTime: '2026-04-01T10:30:00.000Z',
    },
    {
      name: 'offset timestamp',
      headers: { 'x-recorded-at': '2026-04-01T07:30:00-03:00' },
      expectedId: 'job-123',
      expectedTime: '2026-04-01T10:30:00.000Z',
    },
  ])('accepts $name', async ({ headers, expectedId, expectedTime }) => {
    const harness = createHarness();

    const response = await submitRecording(harness, url, { headers });

    expect(response.statusCode).toBe(200);
    expect(harness.jobs[0]).toEqual(expect.objectContaining({
      id: expectedId,
      recordedAt: expectedTime,
    }));
  });

  it('retains the original filename and sanitizes only the artifact filename', async () => {
    const harness = createHarness();

    const response = await submitRecording(harness, url, { filename: 'team retro?.wav' });

    expect(response.statusCode).toBe(200);
    expect(harness.jobs[0].originalFilename).toBe('team retro?.wav');
    expect(harness.artifacts.getUploadPath).toHaveBeenCalledWith('job-123', 'team_retro_.wav');
  });

  it('rejects a missing Recording before collaborator effects', async () => {
    const harness = createHarness();

    const response = await harness.app.inject({
      method: 'POST',
      url,
      headers: {
        'x-api-key': API_KEY,
        'x-job-id': 'job-123',
        'x-recorded-at': '2026-04-01T10:30:00Z',
        'content-type': 'multipart/form-data; boundary=missing-file',
      },
      payload: '--missing-file--\r\n',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'FILE_REQUIRED',
      error: 'A Recording file is required.',
    });
    expect(harness.effects).toEqual([]);
  });

  it('rejects an empty Recording before collaborator effects', async () => {
    const harness = createHarness();

    const response = await submitRecording(harness, url, { content: Buffer.alloc(0) });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'EMPTY_RECORDING',
      error: 'Recording file must not be empty.',
    });
    expect(harness.effects).toEqual([]);
  });

  it.each([
    [1, 200],
    [524_288_000, 200],
    [524_288_001, 413],
  ])('handles a staged Recording size of %i bytes', async (size, expectedStatus) => {
    const harness = createHarness({ stagedSize: size });

    const response = await submitRecording(harness, url, { content: Buffer.from('x') });

    expect(response.statusCode).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(harness.effects).toEqual(['path', 'stage', 'commit', 'persist', 'queue']);
    } else {
      expect(response.json()).toEqual({
        code: 'UPLOAD_TOO_LARGE',
        error: 'Recording exceeds the 500 MiB limit.',
      });
      expect(harness.effects).toEqual(['path', 'stage', 'delete']);
      expect(harness.artifacts.deleteRecording).toHaveBeenCalledWith('/artifact-root/staged-recording');
      expect(harness.artifacts.commitRecording).not.toHaveBeenCalled();
      expect(harness.jobStore.replace).not.toHaveBeenCalled();
      expect(harness.jobQueue.push).not.toHaveBeenCalled();
    }
  });

  it('replaces a prior Job ID with changed valid metadata and media', async () => {
    const harness = createHarness();
    harness.jobs.push({
      id: 'job-123',
      originalFilename: 'old.wav',
      filePath: '/artifact-root/uploads/job-123_old.wav',
      recordedAt: '2026-03-01T12:00:00.000Z',
      serverStatus: 'FAILED',
      currentStep: JobStep.TRANSCRIBING,
      failedStep: JobStep.TRANSCRIBING,
      error: 'old failure',
      options: {
        language: TranscriptionLanguage.ENGLISH,
        template: AIPromptTemplate.MEETING,
      },
    });

    const response = await submitRecording(harness, url, {
      filename: 'replacement.mp3',
      contentType: 'audio/mpeg',
      headers: {
        'x-recorded-at': '2026-04-02T09:00:00-03:00',
        'x-language': 'es',
        'x-template': 'summary',
        'x-min-speakers': '2',
        'x-max-speakers': '5',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      jobId: 'job-123',
      message: 'File queued.',
    });
    expect(harness.jobs).toHaveLength(1);
    expect(harness.jobs[0]).toEqual(expect.objectContaining({
      id: 'job-123',
      originalFilename: 'replacement.mp3',
      filePath: '/artifact-root/uploads/job-123_replacement.mp3',
      recordedAt: '2026-04-02T12:00:00.000Z',
      serverStatus: 'PENDING',
      currentStep: JobStep.QUEUED,
      options: {
        language: 'es',
        template: 'summary',
        minSpeakers: 2,
        maxSpeakers: 5,
      },
    }));
    expect(harness.jobs[0]).not.toHaveProperty('error');
    expect(harness.jobs[0]).not.toHaveProperty('failedStep');
    expect(harness.jobStore.replace).toHaveBeenCalledOnce();
    expect(harness.jobQueue.push).toHaveBeenCalledOnce();
  });
});

describe('Job status contract', () => {
  it('preserves state metadata while recursively redacting text, paths, and artifact-root values', async () => {
    const harness = createHarness();
    const statePairs = [
      ['pending', 'PENDING', JobStep.QUEUED],
      ['extracting', 'PROCESSING', JobStep.EXTRACTING_AUDIO],
      ['transcribing', 'PROCESSING', JobStep.TRANSCRIBING],
      ['transcript-ready', 'COMPLETED', JobStep.TRANSCRIPT_READY],
    ] as const;

    for (const [id, serverStatus, currentStep] of statePairs) {
      harness.jobs.push({
        id,
        originalFilename: `${id}.wav`,
        filePath: `/artifact-root/uploads/${id}.wav`,
        recordedAt: '2026-04-01T10:30:00.000Z',
        serverStatus,
        currentStep,
      });
    }

    harness.jobs.push({
      id: 'failed',
      originalFilename: 'failed.wav',
      filePath: '/artifact-root/uploads/failed.wav',
      recordedAt: '2026-04-01T10:30:00.000Z',
      serverStatus: 'FAILED',
      currentStep: JobStep.TRANSCRIBING,
      failedStep: JobStep.TRANSCRIBING,
      error: 'Whisper failed',
      recoveryAttempts: 2,
      steps: {
        [JobStep.QUEUED]: {
          startedAt: '2026-04-01T10:30:00.000Z',
          completedAt: '2026-04-01T10:30:00.000Z',
        },
        [JobStep.TRANSCRIBING]: {
          startedAt: '2026-04-01T10:31:00.000Z',
        },
      },
      nested: {
        transcriptText: 'TRANSCRIPT_TEXT_SENTINEL',
        summaryText: 'SUMMARY_TEXT_SENTINEL',
        uploadPath: '/artifact-root/uploads/hidden.wav',
        deeper: [{
          audioPath: '/artifact-root/audio/hidden.wav',
          transcriptPath: '/artifact-root/transcript/hidden.txt',
          summaryPath: '/artifact-root/summary/hidden.txt',
          recoveryAttempts: 9,
          alias: '/artifact-root/secret-value',
        }],
      },
    } as JobRecord);

    const list = await harness.app.inject({
      method: 'GET',
      url: '/jobs',
      headers: { 'x-api-key': API_KEY },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      total: 5,
      page: 1,
      limit: 20,
      jobs: [
        ...statePairs.map(([id, serverStatus, currentStep]) => ({
          id,
          serverStatus,
          currentStep,
        })),
        {
          id: 'failed',
          serverStatus: 'FAILED',
          currentStep: JobStep.TRANSCRIBING,
          failedStep: JobStep.TRANSCRIBING,
          error: 'Whisper failed',
        },
      ],
    });

    const detail = await harness.app.inject({
      method: 'GET',
      url: '/jobs/failed',
      headers: { 'x-api-key': API_KEY },
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      id: 'failed',
      serverStatus: 'FAILED',
      currentStep: JobStep.TRANSCRIBING,
      failedStep: JobStep.TRANSCRIBING,
      error: 'Whisper failed',
      steps: {
        [JobStep.QUEUED]: {
          startedAt: '2026-04-01T10:30:00.000Z',
          completedAt: '2026-04-01T10:30:00.000Z',
        },
        [JobStep.TRANSCRIBING]: {
          startedAt: '2026-04-01T10:31:00.000Z',
        },
      },
    });

    const exposed = `${list.body} ${detail.body}`;
    for (const prohibited of [
      'TRANSCRIPT_TEXT_SENTINEL',
      'SUMMARY_TEXT_SENTINEL',
      'filePath',
      'uploadPath',
      'audioPath',
      'transcriptPath',
      'summaryPath',
      'recoveryAttempts',
      '/artifact-root',
    ]) {
      expect(exposed).not.toContain(prohibited);
    }
  });
});

describe('Transcript download contract', () => {
  it.each([
    {
      name: 'unknown Job',
      id: 'missing',
      expectedStatus: 404,
      expectedBody: {
        code: 'JOB_NOT_FOUND',
        error: 'Job was not found.',
      },
    },
    {
      name: 'pending Job',
      id: 'pending',
      job: {
        serverStatus: 'PENDING',
        currentStep: JobStep.QUEUED,
      },
      expectedStatus: 409,
      expectedBody: {
        code: 'TRANSCRIPT_NOT_READY',
        error: 'Transcript is not ready.',
      },
    },
    {
      name: 'completed Job with text',
      id: 'ready',
      job: {
        serverStatus: 'COMPLETED',
        currentStep: JobStep.TRANSCRIPT_READY,
        transcriptPath: '/artifact-root/transcript/ready.txt',
      },
      transcript: 'Speaker 1: Ready transcript',
      expectedStatus: 200,
    },
    {
      name: 'completed Job with null artifact',
      id: 'null-artifact',
      job: {
        serverStatus: 'COMPLETED',
        currentStep: JobStep.TRANSCRIPT_READY,
        transcriptPath: '/artifact-root/transcript/null-artifact.txt',
      },
      transcript: null,
      expectedStatus: 409,
      expectedBody: {
        code: 'TRANSCRIPT_NOT_READY',
        error: 'Transcript is not ready.',
      },
    },
    {
      name: 'completed Job with rejected artifact read',
      id: 'rejected-read',
      job: {
        serverStatus: 'COMPLETED',
        currentStep: JobStep.TRANSCRIPT_READY,
        transcriptPath: '/artifact-root/transcript/rejected-read.txt',
      },
      transcriptError: new Error('artifact unavailable'),
      expectedStatus: 409,
      expectedBody: {
        code: 'TRANSCRIPT_NOT_READY',
        error: 'Transcript is not ready.',
      },
    },
  ])('returns the locked outcome for $name', async ({
    id,
    job,
    transcript,
    transcriptError,
    expectedStatus,
    expectedBody,
  }) => {
    const harness = createHarness();
    if (job) {
      harness.jobs.push({
        id,
        originalFilename: `${id}.wav`,
        filePath: `/artifact-root/uploads/${id}.wav`,
        recordedAt: '2026-04-01T10:30:00.000Z',
        ...job,
      } as JobRecord);
    }
    if (transcriptError) {
      harness.artifacts.readTranscript.mockRejectedValueOnce(transcriptError);
    } else if (transcript !== undefined) {
      harness.artifacts.readTranscript.mockResolvedValueOnce(transcript);
    }

    const response = await harness.app.inject({
      method: 'GET',
      url: `/jobs/${id}/transcript`,
      headers: { 'x-api-key': API_KEY },
    });

    expect(response.statusCode).toBe(expectedStatus);
    if (expectedStatus === 200) {
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toBe(transcript);
      expect(harness.artifacts.readTranscript).toHaveBeenCalledWith(
        '/artifact-root/transcript/ready.txt',
      );
    } else {
      expect(response.json()).toEqual(expectedBody);
    }
  });
});
