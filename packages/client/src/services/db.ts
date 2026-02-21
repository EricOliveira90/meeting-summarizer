import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { randomUUID } from 'crypto';

// Enum matches the UX Status States
export enum LocalJobStatus {
  WAITING_UPLOAD = 'WAITING_UPLOAD', // Recorded locally, server doesn't know it yet
  UPLOADING = 'UPLOADING',           // Currently syncing
  PROCESSING = 'PROCESSING',         // Uploaded, server is working
  READY = 'READY',                   // Server finished, results ready to fetch
  COMPLETED = 'COMPLETED',           // Results fetched and saved to disk
  FAILED = 'FAILED'                  // Error state
}

export interface LocalJob {
  jobId: string;              // The Global UUID (Client generates, Server respects)
  filePath: string;        // Path to the .mkv/.wav file
  originalName: string;
  createdAt: string;       // ISO Date
  status: LocalJobStatus;
  error?: string;          // Last known error message
}

interface ClientSchema {
  jobs: LocalJob[];
}

class JobStateService {
  private db: Low<ClientSchema>;
  private ready: Promise<void>;

  constructor() {
    const dbPath = path.join(process.cwd(), 'client-db.json');
    const adapter = new JSONFile<ClientSchema>(dbPath);
    this.db = new Low(adapter, { jobs: [] });
    this.ready = this.init();
  }

  private async init() {
    await this.db.read();
    this.db.data ||= { jobs: [] };
    await this.db.write();
  }

  public async addRecording(filePath: string): Promise<LocalJob> {
    await this.ready;
    const jobId = randomUUID();
    const job: LocalJob = {
      jobId: jobId,
      filePath,
      originalName: path.basename(filePath),
      createdAt: new Date().toISOString(),
      status: LocalJobStatus.WAITING_UPLOAD
    };

    this.db.data.jobs.push(job);
    await this.db.write();
    return job;
  }

  public async getPendingUploads(): Promise<LocalJob[]> {
    await this.ready;
    return this.db.data.jobs.filter(j => j.status === LocalJobStatus.WAITING_UPLOAD);
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

  public async setError(id: string, errorMsg: string): Promise<void> {
    await this.ready;
    const job = this.db.data.jobs.find(j => j.jobId === id);
    if (job) {
      job.status = LocalJobStatus.FAILED;
      job.error = errorMsg;
      await this.db.write();
    }
  }

  public async getJobByPath(filePath: string): Promise<LocalJob | undefined> {
    await this.ready;
    return this.db.data.jobs.find(j => j.filePath === filePath);
    }
}

export const jobState = new JobStateService();