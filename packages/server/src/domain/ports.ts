import type { Readable } from 'node:stream';
import type { JobRecord } from './models';
import type { QueueInput } from '../services/queue';

export interface JobStore {
  getAll(): Promise<JobRecord[]>;
  getById(id: string): Promise<JobRecord | undefined>;
  replace(job: JobRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface JobQueue {
  push(input: QueueInput): void;
}

export interface StagedRecording {
  stagedPath: string;
  size: number;
}

export interface ArtifactStore {
  readonly root: string;
  getUploadPath(jobId: string, filename: string): string;
  getAudioPath(jobId: string, filename: string): string;
  getTranscriptPath(jobId: string): string;
  getSummaryPath(jobId: string): string;
  ensureDirectories(): Promise<void>;
  stageRecording(path: string, source: Readable): Promise<StagedRecording>;
  commitRecording(stagedPath: string, finalPath: string): Promise<void>;
  deleteRecording(path: string): Promise<void>;
  fileExists(path: string): Promise<boolean>;
  readTranscript(path: string): Promise<string | null>;
  readSummary(jobId: string): Promise<string | null>;
  deleteJobFiles(jobId: string, originalFilename: string): Promise<void>;
}

export interface ServerDependencies {
  jobStore: JobStore;
  jobQueue: JobQueue;
  artifacts: ArtifactStore;
}
