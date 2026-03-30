import { IClientDb, IFileManager, ClientJob, ClientJobStatus } from '../domain';

export interface JobDetails {
    job: ClientJob;
    summary?: string;
    transcript?: string;
}

export class JobManager {
    constructor(
        private db: IClientDb,
        private fs: IFileManager
    ) {}

    public async listJobs(): Promise<ClientJob[]> {
        return this.db.getAll();
    }

    public async getJobDetails(jobId: string): Promise<JobDetails | undefined> {
        const allJobs = await this.db.getAll();
        const job = allJobs.find(j => j.id === jobId);

        if (!job) return undefined;

        let summary: string | undefined;
        let transcript: string | undefined;

        if (job.clientStatus === ClientJobStatus.COMPLETED) {
            const baseName = job.originalFilename.replace(/\.[^/.]+$/, '');

            const summaryPath = this.fs.joinPathsInProjectFolder('summaries', `${baseName}_summary.txt`);
            const transcriptPath = this.fs.joinPathsInProjectFolder('transcriptions', `${baseName}_transcription.txt`);

            if (await this.fs.fileExists(summaryPath)) {
                summary = await this.fs.readFile(summaryPath);
            }

            if (await this.fs.fileExists(transcriptPath)) {
                transcript = await this.fs.readFile(transcriptPath);
            }
        }

        return { job, summary, transcript };
    }

    public async retryJob(jobId: string): Promise<void> {
        const allJobs = await this.db.getAll();
        const job = allJobs.find(j => j.id === jobId);

        if (!job) throw new Error(`Job not found: ${jobId}`);

        if (job.clientStatus !== ClientJobStatus.FAILED && job.clientStatus !== ClientJobStatus.ABANDONED) {
            throw new Error('Only FAILED or ABANDONED jobs can be retried');
        }

        await this.db.resetJobForRetry(jobId);
    }

    public async cancelJob(jobId: string): Promise<void> {
        const allJobs = await this.db.getAll();
        const job = allJobs.find(j => j.id === jobId);

        if (!job) throw new Error(`Job not found: ${jobId}`);

        if (job.clientStatus !== ClientJobStatus.WAITING_UPLOAD) {
            throw new Error('Only WAITING_UPLOAD jobs can be cancelled');
        }

        await this.db.updateStatus(jobId, ClientJobStatus.DELETED);
    }
}
