import { describe, expect, it, vi } from 'vitest';

vi.mock('@google/genai', () => {
  throw new Error('Server services loaded Gemini.');
});
vi.mock('../../src/services/gemini-provider', () => {
  throw new Error('Server services loaded a Summary Provider.');
});
vi.mock('../../src/services/summarizer', () => {
  throw new Error('Server services loaded SummaryService.');
});

describe('Production server service graph', () => {
  it('imports without loading or exporting Summary work', async () => {
    const services = await import('../../src/services');

    expect(services).not.toHaveProperty('GeminiProvider');
    expect(services).not.toHaveProperty('SummaryService');
    expect(services).not.toHaveProperty('summaryService');
  });
});
