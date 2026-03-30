export interface AIProvider {
  name: string;
  summarize(transcript: string, systemPrompt: string): Promise<string>;
}

export class AIProviderFactory {
  private providers = new Map<string, AIProvider>();

  register(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): AIProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown AI provider: ${name}`);
    }
    return provider;
  }

  getDefault(envValue: string | undefined): AIProvider {
    const name = envValue || 'gemini';
    return this.get(name);
  }
}
