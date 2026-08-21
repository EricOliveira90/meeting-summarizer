import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

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

import { buildServer } from '../src/index';

describe('Server API', () => {
  const apiKey = 'test-api-key';
  const app = buildServer({ apiKey });

  beforeAll(async () => {
    await app.ready();
  });

  it('GET / should return online status with permissive CORS', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        'x-api-key': apiKey,
        origin: 'https://notebook.example',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.json()).toEqual({ 
      status: 'online', 
      service: 'Meeting Summarizer Server' 
    });
  });

  it('POST /upload should return 400 when x-job-id header is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'multipart/form-data; boundary=---boundary'
      },
      payload: '-----boundary--'
    });

    expect(response.statusCode).toBe(400); 
    expect(response.json()).toEqual({
      code: 'INVALID_JOB_ID',
      error: 'x-job-id must contain 1-128 letters, digits, hyphens, or underscores and start with a letter or digit.',
    });
  });
});

describe('Server authentication', () => {
  const apiKey = 'configured-key-sentinel';
  const wrongKey = 'wrong-key-sentinel';
  const app = buildServer({ apiKey });
  const routes = [
    { method: 'GET', url: '/' },
    { method: 'GET', url: '/jobs' },
    { method: 'GET', url: '/jobs/missing' },
    { method: 'GET', url: '/jobs/missing/transcript' },
    { method: 'POST', url: '/jobs' },
    { method: 'POST', url: '/upload' },
    { method: 'POST', url: '/jobs/missing/retry' },
    { method: 'DELETE', url: '/jobs/missing' },
  ] as const;

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(routes)('$method $url distinguishes missing, wrong, and correct credentials', async ({ method, url }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const missing = await app.inject({ method, url });
    expect(missing.statusCode).toBe(401);
    expect(missing.json()).toEqual({
      code: 'AUTH_REQUIRED',
      error: 'API credential is required.',
    });

    const wrong = await app.inject({
      method,
      url,
      headers: { 'x-api-key': wrongKey },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({
      code: 'AUTH_INVALID',
      error: 'API credential is invalid.',
    });

    const authenticated = await app.inject({
      method,
      url,
      headers: { 'x-api-key': apiKey },
    });
    expect(authenticated.statusCode).not.toBe(401);

    const observableOutput = [
      missing.body,
      wrong.body,
      authenticated.body,
      ...warn.mock.calls.flat(),
    ].join(' ');
    expect(observableOutput).not.toContain(apiKey);
    expect(observableOutput).not.toContain(wrongKey);

    warn.mockRestore();
  });
});
