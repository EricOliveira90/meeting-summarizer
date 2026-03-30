import path from 'path';
import fs from 'fs';

const DIRS = ['uploads', 'audio_cache', 'transcriptions', 'summaries'] as const;

export class FileManagerService {
  constructor(private readonly baseDir: string) {}

  // --- Path Resolution ---

  getUploadPath(jobId: string, filename: string): string {
    return path.join(this.baseDir, 'uploads', `${jobId}_${filename}`);
  }

  getAudioPath(jobId: string, filename: string): string {
    const name = path.parse(filename).name;
    return path.join(this.baseDir, 'audio_cache', `${jobId}_${name}.wav`);
  }

  getTranscriptPath(jobId: string): string {
    return path.join(this.baseDir, 'transcriptions', `${jobId}_transcript.txt`);
  }

  getSummaryPath(jobId: string): string {
    return path.join(this.baseDir, 'summaries', `${jobId}_summary.txt`);
  }

  // --- Directory Bootstrapping ---

  async ensureDirectories(): Promise<void> {
    for (const dir of DIRS) {
      await fs.promises.mkdir(path.join(this.baseDir, dir), { recursive: true });
    }
  }

  // --- File Reading ---

  async readTranscript(jobId: string): Promise<string | null> {
    return this.readFileOrNull(this.getTranscriptPath(jobId));
  }

  async readSummary(jobId: string): Promise<string | null> {
    return this.readFileOrNull(this.getSummaryPath(jobId));
  }

  // --- File Existence ---

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // --- File Deletion ---

  async deleteJobFiles(jobId: string, originalFilename: string): Promise<void> {
    const paths = [
      this.getUploadPath(jobId, originalFilename),
      this.getAudioPath(jobId, originalFilename),
      this.getTranscriptPath(jobId),
      this.getSummaryPath(jobId),
    ];

    for (const filePath of paths) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // File doesn't exist — that's fine
      }
    }
  }

  // --- Private ---

  private async readFileOrNull(filePath: string): Promise<string | null> {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}
