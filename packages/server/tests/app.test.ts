import { describe, it, expect, beforeAll, vi } from 'vitest';

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
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  it('GET / should return online status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/'
    });

    expect(response.statusCode).toBe(200);
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
        'content-type': 'multipart/form-data; boundary=---boundary'
      },
      payload: '-----boundary--'
    });

    expect(response.statusCode).toBe(400); 
    expect(response.json()).toEqual({ error: 'Missing required header: x-job-id' });
  });
});
