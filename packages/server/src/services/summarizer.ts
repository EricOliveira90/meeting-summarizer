import { GoogleGenAI } from "@google/genai";
import { PROMPTS } from '../config/prompts';
import path from 'path';
import fs from 'fs';

const API_KEY = process.env.GEMINI_API_KEY || '';
const SUMMARIES_DIR = path.join(process.cwd(), 'summaries');

// Ensure directory exists
if (!fs.existsSync(SUMMARIES_DIR)) {
  fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
}

export interface SummaryResult {
  text: string;
  summaryPath: string;
}

export class SummaryService {
  private ai: GoogleGenAI;
  private modelId = 'gemini-2.5-flash';

  constructor() {
    if (!API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY is missing. Summarization will fail.');
    }
    this.ai = new GoogleGenAI({ apiKey: API_KEY });
  }

  /**
   * Generates a structured summary and saves it to a file.
   * @param transcript The full text.
   * @param fileId The job ID to name the file (e.g. "uuid_summary.txt").
   * @param templateKey The type of summary.
   */
  public async summarize(transcript: string, fileId: string, templateKey: string = 'meeting'): Promise<SummaryResult> {
    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript is empty. Cannot summarize.');
    }

    const systemInstruction = PROMPTS[templateKey] || PROMPTS['meeting'];
    console.log(`🧠 Sending transcript to Gemini [Template: ${templateKey}]...`);

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelId,
        contents: [
            { role: 'user', parts: [{ text: systemInstruction }] },
            { role: 'user', parts: [{ text: `TRANSCRIPT:\n${transcript}` }] }
        ]
      });

      if (response.text) {
        const summaryText = response.text;
        
        // Save to file
        const filename = `${fileId}_summary.txt`;
        const summaryPath = path.join(SUMMARIES_DIR, filename);
        
        await fs.promises.writeFile(summaryPath, summaryText, 'utf-8');

        console.log(`✅ Gemini Summary saved to: ${filename}`);
        
        return {
          text: summaryText,
          summaryPath: summaryPath
        };
      } 
      
      throw new Error('No text returned from Gemini API');

    } catch (error: any) {
      console.error('❌ Gemini API Error:', error);
      // Even if it fails, we might want to throw so the job is marked as failed, 
      // or return a basic error text file. Here we throw to let the queue handle it.
      throw new Error(`Gemini Error: ${error.message || error}`);
    }
  }
}

export const summaryService = new SummaryService();