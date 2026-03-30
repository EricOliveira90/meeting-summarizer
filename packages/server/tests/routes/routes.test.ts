import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// Mock external dependencies that have side effects
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {}
    models = { generateContent: vi.fn().mockResolvedValue({ text: 'Mock Summary' }) };
  }
}));

vi.mock('better-queue', () => {
  return {
    default: class MockQueue {
      push = vi.fn();
      destroy = vi.fn();
    }
  };
});

import { buildServer } from '../../src/index';

describe('Route Extraction', () => {
  const app = buildServer();

  beforeAll(async () => {
    await app.ready();
  });

  it('GET / returns health status', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'online',
      service: 'Meeting Summarizer Server'
    });
  });

  it('GET /jobs/:id returns 404 for unknown job', async () => {
    const response = await app.inject({ method: 'GET', url: '/jobs/nonexistent' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Job not found' });
  });

  it('POST /upload returns 400 when no file is uploaded', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: {
        'x-job-id': 'test-123',
        'content-type': 'multipart/form-data; boundary=---boundary'
      },
      payload: '-----boundary--'
    });
    // Should get 400 for missing file
    expect(response.statusCode).toBe(400);
  });
});
