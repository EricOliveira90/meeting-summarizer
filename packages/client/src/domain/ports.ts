import { UploadOptions, UploadResponse, Job, JobResponse } from "@meeting-summarizer/shared";
import { ClientJob, ClientJobStatus, HealthStatus } from "./models";

export interface IIngestion {
  scanDirectory(): Promise<void>;
  ingestFile(oldPath: string): Promise<void>;
}

export interface IClientDb {
  addRecording(filePath: string, datetime: string): Promise<ClientJob>;
  cleanPhantomFiles(): Promise<number>;
  getPendingUploads(): Promise<ClientJob[]>;
  getReadyToFetch(): Promise<ClientJob[]>;
  getAll(): Promise<ClientJob[]>;
  updateStatus(id: string, status: ClientJobStatus): Promise<void>;
  updateOptions(id: string, options: UploadOptions): Promise<void>;
  markCompleted(id: string): Promise<void>;
  setError(id: string, errorMsg: string, isFatal?: boolean): Promise<void>;
  resetJobForRetry(id: string): Promise<void>;
  getJobByPath(filePath: string): Promise<ClientJob | undefined>;
}

export interface INote {
  saveNote(job: ClientJob, summary: string, transcript?: string): Promise<void>;
}

export interface IApiService {
  resetClient(): void;
  checkHealth(): Promise<HealthStatus>;
  /**
   * Uploads a meeting file via multipart/form-data.
   * * @param filePath The local path to the audio/video file.
   * @param options The processing configuration (Language, Template, etc.).
   * @param onProgress Optional callback to track upload percentage.
   */
  uploadMeeting(
    filePath: string,
    id: string,
    options: UploadOptions,
    onProgress?: (percentCompleted: number) => void
  ): Promise<UploadResponse>;

  /**
   * Fetches the current processing status and results for a specific job.
   * * @param jobId The unique UUID of the job.
   */
  getJobStatus(jobId: string): Promise<JobResponse>;

  /**
   * Fetches all jobs currently known to the server.
   */
  getJobs(): Promise<Job[]>;
}

export interface IFileManager {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  joinPathsInProjectFolder(...parts: string[]): string;
  joinPaths(...parts: string[]): string;
}
