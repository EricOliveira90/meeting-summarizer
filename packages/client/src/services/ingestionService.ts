import fs from 'fs';
import path from 'path';
import { IClientDb, ClientJob, IIngestion } from '../domain/clientJob';
import { configService } from './config'; // Assuming configService is exported from your services index
import { promptForMeetingTitle, promptForJobConfig } from '../ui/prompts';

interface NodeError extends Error {
    code?: string;
}

export class IngestionService implements IIngestion {
    private readonly SUPPORTED_EXTENSIONS = ['.mkv', '.mp3', '.opus', '.m4a', '.wav'];

    constructor(private db: IClientDb<ClientJob>) { }

    /**
     * Scans the output directory for supported media files.
     * If a file is not found in the database, it initiates the ingestion process.
     */
    public async scanDirectory(): Promise<void> {
        const outputDir = configService.get('paths').output;

        if (!outputDir || !fs.existsSync(outputDir)) {
            console.error(`❌ Recording directory not found: ${outputDir}`);
            return;
        }

        const files = fs.readdirSync(outputDir);
        let newFilesFound = 0;

        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (!this.SUPPORTED_EXTENSIONS.includes(ext)) {
                continue;
            }

            const fullPath = path.join(outputDir, file);

            // Check if this file is already tracked in the database
            const existingJob = await this.db.getJobByPath(fullPath);

            if (!existingJob) {
                console.log(`\n📄 Found new untracked recording: ${file}`);
                await this.ingestFile(fullPath);
                newFilesFound++;
            }
        }

        if (newFilesFound === 0) {
            console.log('✅ Directory scanned. All files are currently tracked.');
        } else {
            console.log(`\n✅ Successfully ingested ${newFilesFound} new file(s).`);
        }
    }

    /**
     * Orchestrates the ingestion of a single new file.
     * Prompts for title, renames the file, adds it to the DB, and configures AI options.
     */
    public async ingestFile(oldPath: string): Promise<void> {
        // 1. Prompt for Title
        const title = await promptForMeetingTitle();

        // 2. Rename the file safely
        const newPath = this.renameWithRetry(oldPath, title);
        if (!newPath) {
            console.error('❌ Skipping ingestion due to file rename failure.');
            return;
        }

        // 3. Register in Database
        const job = await this.db.addRecording(newPath);

        // 4. Prompt for AI Configuration
        const config = await promptForJobConfig(path.basename(newPath));

        // 5. Update Database with selected options
        await this.db.updateOptions(job.jobId, config);

        console.log(`✅ Job ${job.jobId} created and queued for upload.`);
    }

    /**
     * Generates a timestamped filename and renames the file.
     * Includes retry logic for Windows EBUSY file locking issues.
     * Returns the new file path if successful, or null if it fails.
     */
    private renameWithRetry(oldPath: string, title: string): string | null {
        const dir = path.dirname(oldPath);
        const ext = path.extname(oldPath);
        const originalFilename = path.basename(oldPath);

        // Generate new filename: YYYY-MM-DD_HH-mm_Title.ext
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

        // Clean the title to be safe for Windows file paths
        const sanitizedTitle = title.trim().replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');

        const newFilename = `${dateStr}_${timeStr}_${sanitizedTitle}${ext}`;
        const newPath = path.join(dir, newFilename);

        // Retry loop for renaming (Wait for OBS/System to release lock)
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Small synchronous delay to allow file system release
                const stopUntil = Date.now() + 1000;
                while (Date.now() < stopUntil) { /* busy wait */ }

                fs.renameSync(oldPath, newPath);

                console.log(`\n✅ File renamed successfully:`);
                console.log(`From: ${originalFilename}`);
                console.log(`To:   ${newFilename}\n`);

                return newPath;

            } catch (error) {
                const err = error as NodeError;
                if (err.code === 'EBUSY' && attempt < maxAttempts) {
                    console.log(`File locked, retrying (${attempt}/${maxAttempts})...`);
                } else {
                    console.error(`❌ Failed to rename file after ${attempt} attempts:`, err.message);
                    return null;
                }
            }
        }

        return null;
    }
}