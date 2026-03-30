import fs from 'fs';
import { PROMPTS } from '../config/prompts';
import { AIProviderFactory } from './ai-provider';
import { GeminiProvider } from './gemini-provider';
import { FileManagerService } from './file-manager';

export interface SummaryResult {
  text: string;
  summaryPath: string;
}

// Create and configure the global factory
const factory = new AIProviderFactory();
factory.register(new GeminiProvider());

export { factory as aiProviderFactory };

export class SummaryService {
  private factory: AIProviderFactory;
  private fileManager?: FileManagerService;

  constructor(providerFactory?: AIProviderFactory, fileManager?: FileManagerService) {
    this.factory = providerFactory || factory;
    this.fileManager = fileManager;
  }

  public async summarize(transcript: string, fileId: string, templateKey: string = 'meeting'): Promise<SummaryResult> {
    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcript is empty. Cannot summarize.');
    }

    const systemInstruction = PROMPTS[templateKey] || PROMPTS['meeting'];
    const provider = this.factory.getDefault(process.env.AI_PROVIDER);

    console.log(`🧠 Sending transcript to ${provider.name} [Template: ${templateKey}]...`);

    try {
      const summaryText = await provider.summarize(transcript, systemInstruction);

      // Determine summary path
      let summaryPath: string;
      if (this.fileManager) {
        summaryPath = this.fileManager.getSummaryPath(fileId);
      } else {
        // Fallback for backward compatibility
        const path = await import('path');
        const SUMMARIES_DIR = path.join(process.cwd(), 'summaries');
        if (!fs.existsSync(SUMMARIES_DIR)) {
          fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
        }
        summaryPath = path.join(SUMMARIES_DIR, `${fileId}_summary.txt`);
      }

      await fs.promises.writeFile(summaryPath, summaryText, 'utf-8');
      console.log(`✅ Summary saved to: ${summaryPath}`);

      return { text: summaryText, summaryPath };
    } catch (error: any) {
      console.error(`❌ AI Provider Error:`, error);
      throw new Error(`AI Provider Error: ${error.message || error}`);
    }
  }
}

export const summaryService = new SummaryService();
