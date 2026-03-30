import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIProviderFactory } from '../../src/services/ai-provider';
import type { AIProvider } from '../../src/services/ai-provider';

function makeFakeProvider(name: string): AIProvider {
  return {
    name,
    summarize: vi.fn().mockResolvedValue(`Summary from ${name}`),
  };
}

describe('AIProviderFactory', () => {
  let factory: AIProviderFactory;

  beforeEach(() => {
    factory = new AIProviderFactory();
  });

  it('registers a provider and retrieves it by name', () => {
    const provider = makeFakeProvider('test-provider');
    factory.register(provider);

    expect(factory.get('test-provider')).toBe(provider);
  });

  it('throws when getting an unknown provider', () => {
    expect(() => factory.get('nonexistent')).toThrow('Unknown AI provider: nonexistent');
  });

  it('getDefault returns the provider matching AI_PROVIDER env var', () => {
    const gemini = makeFakeProvider('gemini');
    const claude = makeFakeProvider('claude');
    factory.register(gemini);
    factory.register(claude);

    // Simulate env var
    const result = factory.getDefault('claude');
    expect(result).toBe(claude);
  });

  it('getDefault falls back to gemini when no env var is set', () => {
    const gemini = makeFakeProvider('gemini');
    factory.register(gemini);

    const result = factory.getDefault(undefined);
    expect(result).toBe(gemini);
  });

  it('getDefault throws when default provider is not registered', () => {
    expect(() => factory.getDefault('openai')).toThrow('Unknown AI provider: openai');
  });

  it('provider.summarize delegates correctly', async () => {
    const provider = makeFakeProvider('gemini');
    factory.register(provider);

    const result = await factory.get('gemini').summarize('transcript text', 'system prompt');
    expect(result).toBe('Summary from gemini');
    expect(provider.summarize).toHaveBeenCalledWith('transcript text', 'system prompt');
  });
});
