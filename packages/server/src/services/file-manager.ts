import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { ArtifactStore, StagedRecording } from '../domain/ports';

const DIRS = ['uploads', 'audio_cache', 'transcriptions', 'summaries'] as const;

export class FileManagerService implements ArtifactStore {
  constructor(public readonly root: string) {}

  // --- Path Resolution ---

  getUploadPath(jobId: string, filename: string): string {
    return path.join(this.root, 'uploads', `${jobId}_${filename}`);
  }

  getAudioPath(jobId: string, filename: string): string {
    const name = path.parse(filename).name;
    return path.join(this.root, 'audio_cache', `${jobId}_${name}.wav`);
  }

  getTranscriptPath(jobId: string): string {
    return path.join(this.root, 'transcriptions', `${jobId}_transcript.txt`);
  }

  getSummaryPath(jobId: string): string {
    return path.join(this.root, 'summaries', `${jobId}_summary.txt`);
  }

  // --- Directory Bootstrapping ---

  async ensureDirectories(): Promise<void> {
    for (const dir of DIRS) {
      await fs.promises.mkdir(path.join(this.root, dir), { recursive: true });
    }
  }

  async stageRecording(finalPath: string, source: Readable): Promise<StagedRecording> {
    const stagedPath = `${finalPath}.${randomUUID()}.tmp`;
    let size = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        size += Buffer.byteLength(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(source, counter, fs.createWriteStream(stagedPath));
      return { stagedPath, size };
    } catch (error) {
      await this.deleteRecording(stagedPath);
      throw error;
    }
  }

  async commitRecording(stagedPath: string, finalPath: string): Promise<void> {
    await fs.promises.rename(stagedPath, finalPath);
  }

  async deleteRecording(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Missing staged artifacts need no cleanup.
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
    const artifactFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const paths = [
      this.getUploadPath(jobId, artifactFilename),
      this.getAudioPath(jobId, artifactFilename),
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
