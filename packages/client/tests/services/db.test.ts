import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { LowDB } from '../../src/services/db';
import { ClientJobStatus } from '../../src/domain/clientJob';

describe('Database Service', () => {
    let mockFileSystem: any;
    let testDb: LowDB;
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeEach(() => {
        // 1. Ensure a clean slate before every test (synchronous is fine for test setup)
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // 2. Create a fresh instance pointing to the test file
        mockFileSystem = {
            fileExists: vi.fn().mockResolvedValue(true)
        };

        testDb = new LowDB(mockFileSystem, testDbPath);
    });

    afterEach(() => {
        // 1. Restore all spies to their original behavior FIRST
        vi.restoreAllMocks();

        // 2. Clean up the temp file after the test
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    it('should add a new recording with WAITING_UPLOAD status', async () => {
        // Act
        const job = await testDb.addRecording('C:\\fake\\video.mkv');

        // Assert
        expect(job.filePath).toBe('C:\\fake\\video.mkv');
        expect(job.status).toBe(ClientJobStatus.WAITING_UPLOAD);

        // Verify it actually saved to our test DB file
        const allJobs = await testDb.getAll();
        expect(allJobs.length).toBe(1);
    });

    it('should leave the job as WAITING_UPLOAD if the file exists', async () => {
        // Arrange
        await testDb.addRecording('C:\\fake\\safe-video.mkv');

        // Act
        await testDb.cleanPhantomFiles();

        // Assert
        const jobs = await testDb.getAll();
        expect(jobs[0].status).toBe(ClientJobStatus.WAITING_UPLOAD);
    });

    it('should leave the job as FAILED if the file exists', async () => {
        // Arrange
        await testDb.addRecording('C:\\fake\\safe-video.mkv');
        const initialJobs = await testDb.getAll();
        await testDb.updateStatus(initialJobs[0].jobId, ClientJobStatus.FAILED)

        // Act
        await testDb.cleanPhantomFiles();

        // Assert
        const finalJobs = await testDb.getAll();
        expect(finalJobs[0].status).toBe(ClientJobStatus.FAILED);
    });

    it('should mark a WAITING_UPLOAD job as DELETED if the file is missing from disk', async () => {
        // Arrange
        await testDb.addRecording('C:\\fake\\deleted-video.mkv');

        // fsPromises.access rejects/throws if the file is missing
        mockFileSystem.fileExists.mockResolvedValue(false);

        // Act
        const cleanedCount = await testDb.cleanPhantomFiles();

        // Assert
        const jobs = await testDb.getAll();
        expect(jobs[0].status).toBe(ClientJobStatus.DELETED);
        expect(jobs[0].error).toContain('File was deleted from the local disk.');
        expect(cleanedCount).toBe(1);
    });

    // --- Retrieval Methods ---

    it('should retrieve only jobs with WAITING_UPLOAD status', async () => {
        // Arrange
        const job1 = await testDb.addRecording('C:\\fake\\video1.mkv');
        const job2 = await testDb.addRecording('C:\\fake\\video2.mkv');
        await testDb.updateStatus(job2.jobId, ClientJobStatus.COMPLETED);

        // Act
        const pending = await testDb.getPendingUploads();

        // Assert
        expect(pending.length).toBe(1);
        expect(pending[0].jobId).toBe(job1.jobId);
    });

    it('should retrieve only jobs with READY status', async () => {
        // Arrange
        const job1 = await testDb.addRecording('C:\\fake\\video1.mkv');
        const job2 = await testDb.addRecording('C:\\fake\\video2.mkv');
        await testDb.updateStatus(job1.jobId, ClientJobStatus.READY);

        // Act
        const readyJobs = await testDb.getReadyToFetch();

        // Assert
        expect(readyJobs.length).toBe(1);
        expect(readyJobs[0].jobId).toBe(job1.jobId);
    });

    it('should retrieve all jobs sorted by newest first (descending order)', async () => {
        // Arrange
        vi.useFakeTimers();

        vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
        const olderJob = await testDb.addRecording('C:\\fake\\old.mkv');

        vi.setSystemTime(new Date('2026-01-01T11:00:00Z'));
        const newerJob = await testDb.addRecording('C:\\fake\\new.mkv');

        vi.useRealTimers();

        // Act
        const allJobs = await testDb.getAll();

        // Assert
        expect(allJobs.length).toBe(2);
        expect(allJobs[0].jobId).toBe(newerJob.jobId); // Newest should be first
        expect(allJobs[1].jobId).toBe(olderJob.jobId);
    });

    it('should find a job by its exact file path', async () => {
        // Arrange
        const targetPath = 'C:\\fake\\target.mkv';
        await testDb.addRecording('C:\\fake\\other.mkv');
        const expectedJob = await testDb.addRecording(targetPath);

        // Act
        const foundJob = await testDb.getJobByPath(targetPath);

        // Assert
        expect(foundJob).toBeDefined();
        expect(foundJob?.jobId).toBe(expectedJob.jobId);
    });

    // --- Update Methods ---

    it('should update a specific job status', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');

        // Act
        await testDb.updateStatus(job.jobId, ClientJobStatus.PROCESSING);

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.PROCESSING);
    });

    it('should mark a job as COMPLETED', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');

        // Act
        await testDb.markCompleted(job.jobId);

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.COMPLETED);
    });

    // --- Error, Retry, and Abandonment Methods ---

    it('should increment retryCount and set status to FAILED on initial errors', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');
        const errorMessage = 'Network timeout during upload';

        // Act
        await testDb.setError(job.jobId, errorMessage);

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.FAILED);
        expect(allJobs[0].retryCount).toBe(1);
        expect(allJobs[0].error).toBe(errorMessage);
    });

    it('should set status to ABANDONED after 4 retries', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');

        // Act - Simulate failing 4 times
        await testDb.setError(job.jobId, 'Error 1');
        await testDb.setError(job.jobId, 'Error 2');
        await testDb.setError(job.jobId, 'Error 3');
        await testDb.setError(job.jobId, 'Fatal Error 4');

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.ABANDONED);
        expect(allJobs[0].retryCount).toBe(4);
        expect(allJobs[0].error).toBe('Fatal Error 4');
    });

    it('should reset an ABANDONED job back to WAITING_UPLOAD with 0 retries', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');

        // Force it into an ABANDONED state
        await testDb.setError(job.jobId, 'Error 1');
        await testDb.setError(job.jobId, 'Error 2');
        await testDb.setError(job.jobId, 'Error 3');
        await testDb.setError(job.jobId, 'Error 4');

        // Act - User triggers manual reset
        await testDb.resetJobForRetry(job.jobId);

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.WAITING_UPLOAD);
        expect(allJobs[0].retryCount).toBe(0);
        expect(allJobs[0].error).toBeUndefined(); // Should clear the old error
    });

    it('should immediately mark a job as ABANDONED if the error is fatal (e.g., 401 Auth Error)', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');
        const errorMessage = '401 Unauthorized: Invalid API Key';

        // Act - Pass true for the isFatal parameter
        await testDb.setError(job.jobId, errorMessage, true);

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.ABANDONED);
        // The retry count should not increment on a fatal error
        expect(allJobs[0].retryCount).toBe(0);
        expect(allJobs[0].error).toBe(errorMessage);
    });

    it('should still allow an ABANDONED fatal job to be manually reset by the user', async () => {
        // Arrange
        const job = await testDb.addRecording('C:\\fake\\video.mkv');
        await testDb.setError(job.jobId, '401 Unauthorized', true); // Fatal error

        // Act - User fixes their API key in settings and clicks "Retry"
        await testDb.resetJobForRetry(job.jobId);

        // Assert
        const allJobs = await testDb.getAll();
        expect(allJobs[0].status).toBe(ClientJobStatus.WAITING_UPLOAD);
        expect(allJobs[0].retryCount).toBe(0);
        expect(allJobs[0].error).toBeUndefined();
    });
});