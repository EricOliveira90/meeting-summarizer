import { describe, it, expect } from 'vitest';
import { TranscriptionLanguage } from './index';

describe('Shared Definitions', () => {
  it('should have correct language codes', () => {
    expect(TranscriptionLanguage.ENGLISH).toBe('en');
    expect(TranscriptionLanguage.PORTUGUESE).toBe('pt');
  });
});