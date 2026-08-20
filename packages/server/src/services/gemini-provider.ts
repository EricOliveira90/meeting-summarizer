import { GoogleGenAI } from "@google/genai";
import { AIProvider } from './ai-provider';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private ai?: GoogleGenAI;
  private readonly apiKey: string;
  private readonly modelId: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || '';
    this.modelId = model || process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
  }

  async summarize(transcript: string, systemPrompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is missing.');
    }
    this.ai ??= new GoogleGenAI({ apiKey: this.apiKey });

    const response = await this.ai.models.generateContent({
      model: this.modelId,
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'user', parts: [{ text: `TRANSCRIPT:\n${transcript}` }] }
      ]
    });

    if (response.text) {
      return response.text;
    }

    throw new Error('No text returned from Gemini API');
  }
}
