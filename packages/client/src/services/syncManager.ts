import { IClientDb, ClientJob, ClientJobStatus, IApiService, INote, SyncError, IIngestion, IFileManager } from '../domain/clientJob';
import { UploadOptions } from '@meeting-summarizer/shared';
import { promptForJobConfig } from '../ui/prompts';


export class SyncManager {
    private readonly MAX_RETRIES = 3;

    constructor(
        private api: IApiService,
        private db: IClientDb<ClientJob>,
        private note: INote,
        private ingestion: IIngestion,
        private fs: IFileManager
    ) { }

    /**
     * The Master Orchestrator
     * Executes the sync lifecycle in the safest logical order.
     */
    public async runFullSyncCycle(): Promise<void> {

        // 1. Auto-ingest any new files dropped into the folder
        await this.ingestion.scanDirectory();

        // 2. Check if anything finished on the server while we were away
        await this.updateActiveStates();

        // 3. Download newly finished items so the user gets them ASAP
        await this.fetchResults();

        // 4. Start uploading new or failed files
        await this.pushPending();
    }

    /**
     * The Status Poller
     * Checks the server to see if the process have finished.
     */
    private async updateActiveStates(): Promise<void> {
        const allJobs = await this.db.getAll();
        const processingJobs = allJobs.filter(job => job.status === ClientJobStatus.PROCESSING);

        for (const job of processingJobs) {
            try {
                const serverJob = await this.api.getJobStatus(job.jobId);

                if (serverJob.status === 'COMPLETED') {
                    await this.db.updateStatus(job.jobId, ClientJobStatus.READY);
                } else if (serverJob.status === 'FAILED') {
                    // Server crashed during processing (Whisper/Gemini error)
                    await this.db.setError(job.jobId, serverJob.error || 'Server processing failed', true);
                }
                // If still PENDING, EXTRACTING, TRANSCRIBING, etc., we just leave local status as PROCESSING.

            } catch (error) {
                // Tunnel offline or API unreachable. Do nothing; leave as PROCESSING to check again later.
                continue;
            }
        }
    }

    /**
     * The Artifact Downloader
     * Retrieves final text payloads and saves them to local .txt files and Obsidian.
     */
    private async fetchResults(): Promise<void> {
        const readyJobs = await this.db.getReadyToFetch();

        for (const job of readyJobs) {
            try {
                const finalPayload = await this.api.getJobStatus(job.jobId);

                if (finalPayload.summaryText) {
                    // Strip the media extension and create the .txt base name
                    const baseName = job.originalFilename.replace(/\.[^/.]+$/, "");
                    
                    // NEW: Traverse up two levels from src/services to the package root
                    const summaryPath = this.fs.joinPaths('summaries', `${baseName}_summary.txt`);
                    await this.fs.writeFile(summaryPath, finalPayload.summaryText);

                    if (finalPayload.transcriptText) {
                        const transcriptPath = this.fs.joinPaths('transcriptions', `${baseName}_transcription.txt`);
                        await this.fs.writeFile(transcriptPath, finalPayload.transcriptText);
                    }

                    // Pre-existing logic: Save to Obsidian and mark as complete
                    await this.note.saveNote(job, finalPayload.summaryText, finalPayload.transcriptText)
                    await this.db.markCompleted(job.jobId);
                }
            } catch (error) {
                // If tunnel drops during fetch, catch and leave as READY to try next time.
                console.error(`Failed to fetch results for ${job.jobId}`, error);
            }
        }
    }

    /**
     * Uploads a single job. Prompts for configuration if missing.
     */
    public async pushJob(job: ClientJob): Promise<void> {
        let options = job.options

        // Prompt for configuration if it hasn't been set yet
        if (!job.options || !job.options.language || !job.options.template) {
            options = await promptForJobConfig(job.originalFilename);
            await this.db.updateOptions(job.jobId, options);
        }

        await this.db.updateStatus(job.jobId, ClientJobStatus.UPLOADING);

        try {
            await this.api.uploadMeeting(job.filePath, job.jobId, options as UploadOptions);

            // Success: Server has it, reset retries
            await this.db.updateStatus(job.jobId, ClientJobStatus.PROCESSING);
            await this.db.resetJobForRetry(job.jobId); // Resets retryCount to 0

        } catch (error) {
            const isFatal = error instanceof SyncError && !error.isTransient;

            if (isFatal) {
                // e.g., 401 Unauthorized API Key
                await this.db.setError(job.jobId, error.message, true);
            } else {
                // Network/Tunnel error: Increment retry and mark FAILED or ABANDONED
                await this.db.setError(job.jobId, error instanceof Error ? error.message : 'Upload failed', false);
            }
        }
    }

    /**
     * The Upload Handler
     * Sends new recordings and retries previously failed uploads.
     */
    private async pushPending(): Promise<void> {
        const allJobs = await this.db.getAll();

        // Filter for WAITING_UPLOAD and FAILED (under max retries)
        const targets = allJobs.filter(job =>
            job.status === ClientJobStatus.WAITING_UPLOAD ||
            (job.status === ClientJobStatus.FAILED && job.retryCount < this.MAX_RETRIES)
        );

        for (const job of targets) {
            await this.pushJob(job);
        }
    }
}