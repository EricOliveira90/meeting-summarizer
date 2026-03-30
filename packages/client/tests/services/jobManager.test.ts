import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobManager } from '../../src/services/jobManager';
import { ClientJobStatus } from '../../src/domain';

describe('JobManager', () => {
    let mockDb: any;
    let mockFs: any;
    let jobManager: JobManager;

    beforeEach(() => {
        vi.clearAllMocks();

        mockDb = {
            getAll: vi.fn().mockResolvedValue([]),
            updateStatus: vi.fn().mockResolvedValue(undefined),
            resetJobForRetry: vi.fn().mockResolvedValue(undefined),
        };

        mockFs = {
            readFile: vi.fn().mockResolvedValue('file content'),
            fileExists: vi.fn().mockResolvedValue(true),
            joinPathsInProjectFolder: vi.fn().mockImplementation((...parts: string[]) => parts.join('/')),
        };

        jobManager = new JobManager(mockDb, mockFs);
    });

    describe('listJobs()', () => {
        it('should return all jobs from the database', async () => {
            const fakeJobs = [
                { id: '1', originalFilename: 'meeting1.mkv', clientStatus: ClientJobStatus.COMPLETED, recordedAt: '2026-01-01T10:00:00Z' },
                { id: '2', originalFilename: 'meeting2.mkv', clientStatus: ClientJobStatus.FAILED, recordedAt: '2026-01-02T10:00:00Z' },
            ];
            mockDb.getAll.mockResolvedValue(fakeJobs);

            const jobs = await jobManager.listJobs();

            expect(jobs).toHaveLength(2);
            expect(mockDb.getAll).toHaveBeenCalledOnce();
        });
    });

    describe('getJobDetails()', () => {
        it('should return job details with summary and transcript for COMPLETED jobs', async () => {
            const fakeJob = {
                id: '1',
                originalFilename: 'Q1_Planning.mkv',
                clientStatus: ClientJobStatus.COMPLETED,
                recordedAt: '2026-01-01T10:00:00Z'
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);
            mockFs.readFile.mockResolvedValueOnce('Summary text here');
            mockFs.readFile.mockResolvedValueOnce('Transcript text here');

            const details = await jobManager.getJobDetails('1');

            expect(details).toBeDefined();
            expect(details!.job).toEqual(fakeJob);
            expect(details!.summary).toBe('Summary text here');
            expect(details!.transcript).toBe('Transcript text here');
        });

        it('should return job details with error for FAILED jobs', async () => {
            const fakeJob = {
                id: '2',
                originalFilename: 'broken.mkv',
                clientStatus: ClientJobStatus.FAILED,
                recordedAt: '2026-01-01T10:00:00Z',
                error: 'Network timeout'
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);

            const details = await jobManager.getJobDetails('2');

            expect(details).toBeDefined();
            expect(details!.job.error).toBe('Network timeout');
            expect(details!.summary).toBeUndefined();
            expect(details!.transcript).toBeUndefined();
        });

        it('should return undefined for a non-existent job', async () => {
            mockDb.getAll.mockResolvedValue([]);

            const details = await jobManager.getJobDetails('non-existent');

            expect(details).toBeUndefined();
        });

        it('should handle missing summary/transcript files gracefully for COMPLETED jobs', async () => {
            const fakeJob = {
                id: '3',
                originalFilename: 'meeting.mkv',
                clientStatus: ClientJobStatus.COMPLETED,
                recordedAt: '2026-01-01T10:00:00Z'
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);
            mockFs.fileExists.mockResolvedValue(false);

            const details = await jobManager.getJobDetails('3');

            expect(details).toBeDefined();
            expect(details!.summary).toBeUndefined();
            expect(details!.transcript).toBeUndefined();
        });
    });

    describe('retryJob()', () => {
        it('should reset a FAILED job to WAITING_UPLOAD with retry count cleared', async () => {
            const fakeJob = {
                id: '1',
                clientStatus: ClientJobStatus.FAILED,
                retryCount: 2,
                error: 'Network error'
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);

            await jobManager.retryJob('1');

            expect(mockDb.resetJobForRetry).toHaveBeenCalledWith('1');
        });

        it('should reset an ABANDONED job to WAITING_UPLOAD with retry count cleared', async () => {
            const fakeJob = {
                id: '2',
                clientStatus: ClientJobStatus.ABANDONED,
                retryCount: 4,
                error: 'Max retries exceeded'
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);

            await jobManager.retryJob('2');

            expect(mockDb.resetJobForRetry).toHaveBeenCalledWith('2');
        });

        it('should throw if trying to retry a job that is not FAILED or ABANDONED', async () => {
            const fakeJob = {
                id: '3',
                clientStatus: ClientJobStatus.COMPLETED,
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);

            await expect(jobManager.retryJob('3'))
                .rejects.toThrow('Only FAILED or ABANDONED jobs can be retried');
        });
    });

    describe('cancelJob()', () => {
        it('should mark a WAITING_UPLOAD job as DELETED', async () => {
            const fakeJob = {
                id: '1',
                clientStatus: ClientJobStatus.WAITING_UPLOAD,
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);

            await jobManager.cancelJob('1');

            expect(mockDb.updateStatus).toHaveBeenCalledWith('1', ClientJobStatus.DELETED);
        });

        it('should throw if trying to cancel a job that is not WAITING_UPLOAD', async () => {
            const fakeJob = {
                id: '2',
                clientStatus: ClientJobStatus.PROCESSING,
            };
            mockDb.getAll.mockResolvedValue([fakeJob]);

            await expect(jobManager.cancelJob('2'))
                .rejects.toThrow('Only WAITING_UPLOAD jobs can be cancelled');
        });
    });
});
