import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fsPromises from 'fs/promises';
import { randomUUID } from 'crypto';

export enum LocalJobStatus {
  WAITING_UPLOAD = 'WAITING_UPLOAD',
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',                 // Intermittent error, will retry
  ABANDONED = 'ABANDONED',           // Max retries hit or fatal error
  DELETED = 'DELETED'                // User deleted the local file
}

export interface LocalJob {
  jobId: string;
  filePath: string;
  originalName: string;
  createdAt: string;
  status: LocalJobStatus;
  error?: string;
  retryCount: number;
}

interface ClientSchema {
  jobs: LocalJob[];
}

export class JobStateDB {
  private db: Low<ClientSchema>;
  private ready: Promise<void>;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), 'client-db.json');
    const adapter = new JSONFile<ClientSchema>(finalPath);
    this.db = new Low(adapter, { jobs: [] });
    this.ready = this.init();
  }

  private async init() {
    try {
      await this.db.read();
      this.db.data ||= { jobs: [] };
      await this.db.write();
    } catch (error) {
      console.error('Failed to initialize local database:', error);
      this.db.data = { jobs: [] }; 
    }
  }

  public async addRecording(filePath: string): Promise<LocalJob> {
    await this.ready;
    const jobId = randomUUID();
    const job: LocalJob = {
      jobId: jobId,
      filePath,
      originalName: path.basename(filePath),
      createdAt: new Date().toISOString(),
      status: LocalJobStatus.WAITING_UPLOAD,
      retryCount: 0
    };

    this.db.data.jobs.push(job);
    await this.db.write();
    return job;
  }

  /**
   * Scans the local database for jobs that still rely on the local file.
   * If the user manually deleted the audio file from their OS,
   * this marks the database record as DELETED to prevent phantom upload crashes.
   */
  public async cleanPhantomFiles(): Promise<number> {
    await this.ready;
    let cleanedCount = 0;

    const vulnerableStates = [
      LocalJobStatus.WAITING_UPLOAD,
      LocalJobStatus.FAILED // FAILED means it failed to upload and we want to retry
    ];

    for (const job of this.db.data.jobs) {
      if (vulnerableStates.includes(job.status)) {
        try {
          await fsPromises.access(job.filePath);
        } catch {
          // If access throws, the file is missing or inaccessible
          job.status = LocalJobStatus.DELETED;
          job.error = 'File was deleted from the local disk.';
          cleanedCount++;
        }
      }
    }

    // Only write to the JSON file if we actually changed something
    if (cleanedCount > 0) {
      await this.db.write();
    }

    return cleanedCount;
  }

  public async getPendingUploads(): Promise<LocalJob[]> {
    await this.ready;
    return this.db.data!.jobs.filter(j => j.status === LocalJobStatus.WAITING_UPLOAD);
  }

  public async getReadyToFetch(): Promise<LocalJob[]> {
    await this.ready;
    return this.db.data.jobs.filter(j => j.status === LocalJobStatus.READY);
  }

  public async getAll(): Promise<LocalJob[]> {
    await this.ready;
    return [...this.db.data.jobs].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public async updateStatus(id: string, status: LocalJobStatus): Promise<void> {
    await this.ready;
    const job = this.db.data.jobs.find(j => j.jobId === id);
    if (job) {
      job.status = status;
      await this.db.write();
    }
  }

  public async markCompleted(id: string): Promise<void> {
    await this.updateStatus(id, LocalJobStatus.COMPLETED);
  }

  /**
   * Records an error for a job.
   * @param isFatal If true (e.g., 401 Auth Error), skips retries and abandons the job immediately.
   */
  public async setError(id: string, errorMsg: string, isFatal: boolean = false): Promise<void> {
    await this.ready;
    const job = this.db.data!.jobs.find(j => j.jobId === id);
    
    if (job) {
      job.error = errorMsg;

      if (isFatal) {
        job.status = LocalJobStatus.ABANDONED;
      } else {
        job.retryCount += 1;
        
        if (job.retryCount >= 4) {
          job.status = LocalJobStatus.ABANDONED;
        } else {
          job.status = LocalJobStatus.FAILED;
        }
      }
      
      await this.db.write();
    }
  }
  
  /**
   * Manually resets a FAILED or ABANDONED job back to a fresh state,
   * allowing the upload worker to pick it up again.
   */
  public async resetJobForRetry(id: string): Promise<void> {
    await this.ready;
    const job = this.db.data.jobs.find(j => j.jobId === id);
    
    if (job) {
      job.retryCount = 0;
      job.status = LocalJobStatus.WAITING_UPLOAD;
      job.error = undefined;
      
      await this.db.write();
    }
  }

  public async getJobByPath(filePath: string): Promise<LocalJob | undefined> {
    await this.ready;
    return this.db.data.jobs.find(j => j.filePath === filePath);
  }
}
