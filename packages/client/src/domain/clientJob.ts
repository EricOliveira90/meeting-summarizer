import { UploadOptions, UploadResponse, Job, NoteTemplate } from "@meeting-summarizer/shared";

/**
 * Contract for handling local file discovery and database ingestion.
 */
export interface IIngestion {
  /**
   * Scans the configured output directory for supported media files
   * and ingests any that are not currently tracked in the database.
   */
  scanDirectory(): Promise<void>;

  /**
   * Orchestrates the ingestion of a single new file.
   * Prompts for title, renames the file, adds it to the DB, and configures AI options.
   * * @param oldPath The current absolute path of the recording file.
   */
  ingestFile(oldPath: string): Promise<void>;
}

export enum ClientJobStatus {
  WAITING_UPLOAD = 'WAITING_UPLOAD',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',                 // Intermittent error, will retry
  ABANDONED = 'ABANDONED',           // Max retries hit or fatal error
  DELETED = 'DELETED'                // User deleted the local file
}

export interface ClientJob {
  jobId: string;
  filePath: string;
  originalFilename: string;
  status: ClientJobStatus;
  retryCount: number;
  createdAt: string;
  error?: string;
  options?: UploadOptions;
  noteTemplate?: NoteTemplate
}

export interface IClientDb<T> {
  addRecording(filePath: string, datetime: string): Promise<T>;
  cleanPhantomFiles(): Promise<number>;
  getPendingUploads(): Promise<T[]>;
  getReadyToFetch(): Promise<T[]>;
  getAll(): Promise<T[]>;
  updateStatus(id: string, status: ClientJobStatus): Promise<void>;
  updateOptions(id: string, options: UploadOptions): Promise<void>;
  markCompleted(id: string): Promise<void>;
  setError(id: string, errorMsg: string, isFatal?: boolean): Promise<void>;
  resetJobForRetry(id: string): Promise<void>;
  getJobByPath(filePath: string): Promise<T | undefined>;
}

export interface INote {
    saveNote(job: ClientJob, summary: string, transcript?: string): Promise<void>;
}

export class SyncError extends Error {
  constructor(
    public message: string,
    public isTransient: boolean, // true for ECONNREFUSED/ECONNRESET (Tunnel down), false for 401 (Bad Key)
    public statusCode?: number
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export interface HealthStatus {
  isOnline: boolean;
  latencyMs: number;
}

export interface IApiService {
  /**
   * Resets the internal HTTP client. 
   * Useful when the user updates their server IP or API key.
   */
  resetClient(): void;

  /**
   * Checks the connection health to the server over the SSH tunnel.
   */
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
  getJobStatus(jobId: string): Promise<Job>;

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