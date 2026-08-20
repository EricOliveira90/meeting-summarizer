import { afterEach, describe, expect, it, vi } from 'vitest';

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

import { startServer } from '../src/index';

describe('Direct server startup', () => {
  const originalApiKey = process.env.API_KEY;
  const originalExitCode = process.exitCode;

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('exits nonzero before listening when API_KEY is absent', async () => {
    delete process.env.API_KEY;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await startServer();

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls).toEqual([
      ['CONFIG_API_KEY_REQUIRED'],
      ['API_KEY is required.'],
    ]);
  });
});
