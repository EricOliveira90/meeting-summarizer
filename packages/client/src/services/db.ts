import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { randomUUID } from 'crypto';
import { IClientDb, IFileManager, ClientJob, ClientJobStatus } from '../domain';
import { UploadOptions } from '@meeting-summarizer/shared';

interface ClientSchema {
  jobs: ClientJob[];
}

export class LowDB implements IClientDb {
  private fs: IFileManager
  private db: Low<ClientSchema>;
  private ready: Promise<void>;

  constructor(fileManager: IFileManager, dbPath?: string) {
    this.fs = fileManager
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

  public async addRecording(filePath: string, datetime: string): Promise<ClientJob> {
    await this.ready;
    const jobId = randomUUID();
    const job: ClientJob = {
      id: jobId,
      filePath,
      originalFilename: path.basename(filePath),
      recordedAt: datetime,
      clientStatus: ClientJobStatus.WAITING_UPLOAD,
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
      ClientJobStatus.WAITING_UPLOAD,
      ClientJobStatus.FAILED // FAILED means it failed to upload and we want to retry
    ];

    for (const job of this.db.data.jobs) {
      if (vulnerableStates.includes(job.clientStatus)) {
        const exists = await this.fs.fileExists(job.filePath);

        if (!exists) {
          job.clientStatus = ClientJobStatus.DELETED;
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

  public async getPendingUploads(): Promise<ClientJob[]> {
    await this.ready;
    return this.db.data!.jobs.filter(j => j.clientStatus === ClientJobStatus.WAITING_UPLOAD);
  }

  public async getReadyToFetch(): Promise<ClientJob[]> {
    await this.ready;
    return this.db.data.jobs.filter(j => j.clientStatus === ClientJobStatus.READY);
  }

  public async getAll(): Promise<ClientJob[]> {
    await this.ready;
    return [...this.db.data.jobs].sort((a, b) =>
      new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
  }

  public async updateStatus(id: string, status: ClientJobStatus): Promise<void> {
    await this.ready;
    const job = this.db.data.jobs.find(j => j.id === id);
    if (job) {
      job.clientStatus = status;
      await this.db.write();
    }
  }

  public async updateOptions(id: string, options: UploadOptions): Promise<void> {
    await this.ready;
    const job = this.db.data.jobs.find(j => j.id === id);
    if (job) {
      job.options = options;
      await this.db.write();
    }
  }

  public async markCompleted(id: string): Promise<void> {
    await this.updateStatus(id, ClientJobStatus.COMPLETED);
  }

  /**
   * Records an error for a job.
   * @param isFatal If true (e.g., 401 Auth Error), skips retries and abandons the job immediately.
   */
  public async setError(id: string, errorMsg: string, isFatal: boolean = false): Promise<void> {
    await this.ready;
    const job = this.db.data!.jobs.find(j => j.id === id);

    if (job) {
      job.error = errorMsg;

      if (isFatal) {
        job.clientStatus = ClientJobStatus.ABANDONED;
      } else {
        job.retryCount += 1;

        if (job.retryCount >= 4) {
          job.clientStatus = ClientJobStatus.ABANDONED;
        } else {
          job.clientStatus = ClientJobStatus.FAILED;
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
    const job = this.db.data.jobs.find(j => j.id === id);

    if (job) {
      job.retryCount = 0;
      job.clientStatus = ClientJobStatus.WAITING_UPLOAD;
      job.error = undefined;

      await this.db.write();
    }
  }

  public async getJobByPath(filePath: string): Promise<ClientJob | undefined> {
    await this.ready;
    return this.db.data.jobs.find(j => j.filePath === filePath);
  }
}
