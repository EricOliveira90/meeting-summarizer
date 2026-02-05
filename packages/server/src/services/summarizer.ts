import { GoogleGenAI } from "@google/genai";

// Requires GEMINI_API_KEY in your packages/server/.env file
const API_KEY = process.env.GEMINI_API_KEY || '';

export class SummaryService {
  private ai: GoogleGenAI;
  // Use 'gemini-1.5-flash' for stability, or 'gemini-2.0-flash' if available in your region
  private modelId = 'gemini-2.5-flash'; 

  constructor() {
    if (!API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY is missing. Summarization will fail.');
    }
    // Initialize the new client
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
  }

  /**
   * Generates a structured summary from a raw transcript.
   * @param transcript - The full text of the meeting
   * @returns Promise resolving to the markdown summary
   */
  public async summarize(transcript: string): Promise<string> {
    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript is empty. Cannot summarize.');
    }

    console.log(`🧠 Sending transcript (${transcript.length} chars) to Gemini (${this.modelId})...`);

    const prompt = `
      Responda de forma empática à história que a Amanda está contando abaixo.
      
      Aqui está a história:
      "${transcript}"
    `;

    try {
      // New SDK call structure
      const response = await this.ai.models.generateContent({
        model: this.modelId,
        contents: prompt, // In the new SDK, 'contents' can be a simple string for text-only
      });

      // The new SDK exposes text directly on the response object
      if (response.text) {
        console.log('✅ Gemini Summary Generated.');
        return response.text;
      } 
      
      throw new Error('No text returned from Gemini API');

    } catch (error: any) {
      console.error('❌ Gemini API Error:', error);
      // Fallback: Return formatted error so the file is still saved
      return `**Error Generating Summary:** ${error.message || error}\n\n(The raw transcript is safe)`;
    }
  }
}

export const summaryService = new SummaryService();