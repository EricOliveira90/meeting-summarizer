import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobStateDB, LocalJobStatus } from '../../src/services/db';
import fs from 'fs';
import path from 'path';

describe('Database Service (db.ts)', () => {
    let testDb: JobStateDB;
    const testDbPath = path.join(__dirname, 'test-db.json');

    beforeEach(() => {
        // 1. Ensure a clean slate before every test
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        // 2. Create a fresh instance pointing to the test file
        testDb = new JobStateDB(testDbPath);

        // 3. Spy on existsSync so we can modify its behavior in specific tests
        // By default, it will act normally (call the real fs.existsSync)
        vi.spyOn(fs, 'existsSync');
    });

    afterEach(() => {
        // 1. Restore all spies to their original behavior FIRST
        // This is critical so our cleanup logic below doesn't use a mocked existsSync
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
        expect(job.status).toBe(LocalJobStatus.WAITING_UPLOAD);

        // Verify it actually saved to our test DB file
        const allJobs = await testDb.getAll();
        expect(allJobs.length).toBe(1);
    });
  
    it('should leave the job as WAITING_UPLOAD if the file exists', async () => {
        // Arrange
        await testDb.addRecording('C:\\fake\\safe-video.mkv');
        vi.mocked(fs.existsSync).mockReturnValue(true); 

        // Act
        await testDb.cleanPhantomFiles();

        // Assert
        const jobs = await testDb.getAll();
        expect(jobs[0].status).toBe(LocalJobStatus.WAITING_UPLOAD);
    });
  
    it('should leave the job as FAILED if the file exists', async () => {
        // Arrange
        await testDb.addRecording('C:\\fake\\safe-video.mkv');
        const initialJobs = await testDb.getAll();
        await testDb.updateStatus(initialJobs[0].jobId, LocalJobStatus.FAILED)
        vi.mocked(fs.existsSync).mockReturnValue(true);

        // Act
        await testDb.cleanPhantomFiles();

        // Assert
        const finalJobs = await testDb.getAll();
        expect(finalJobs[0].status).toBe(LocalJobStatus.FAILED);
    });

    it('should mark a WAITING_UPLOAD job as DELETED if the file is missing from disk', async () => {
        // Arrange
        await testDb.addRecording('C:\\fake\\deleted-video.mkv'); // Adds as WAITING_UPLOAD
        vi.mocked(fs.existsSync).mockReturnValue(false); // Simulate user deleted it

        // Act
        const cleanedCount = await testDb.cleanPhantomFiles();

        // Assert
        const jobs = await testDb.getAll();
        expect(jobs[0].status).toBe(LocalJobStatus.DELETED);
        expect(jobs[0].error).toContain('File was deleted from the local disk.');
        expect(cleanedCount).toBe(1);
    });
});