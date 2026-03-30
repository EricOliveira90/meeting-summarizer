import { GoogleGenAI } from "@google/genai";
import { AIProvider } from './ai-provider';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI;
  private modelId: string;

  constructor(apiKey?: string, model?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY || '';
    this.modelId = model || process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

    if (!key) {
      console.warn('⚠️ GEMINI_API_KEY is missing. Summarization will fail.');
    }
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  async summarize(transcript: string, systemPrompt: string): Promise<string> {
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
