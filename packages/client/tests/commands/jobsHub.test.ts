import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientJob, ClientJobStatus, NoteTemplate } from '../../src/domain/models';
import { IFileManager } from '../../src/domain/ports';
import { JobManager, JobDetails } from '../../src/services/jobManager';
import { NoteService, RegenerateResult } from '../../src/services/note';

// Mock inquirer before importing the module under test
vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn(),
    },
}));

import inquirer from 'inquirer';
import { jobsHubCommand } from '../../src/commands/jobsHub';

function makeJob(overrides: Partial<ClientJob> = {}): ClientJob {
    return {
        id: 'aaaa1111-2222-3333-4444-555566667777',
        filePath: '/recordings/test.wav',
        originalFilename: 'test-recording.wav',
        recordedAt: '2026-03-29T14:30:00.000Z',
        clientStatus: ClientJobStatus.COMPLETED,
        retryCount: 0,
        ...overrides,
    };
}

function makeMockJobManager(): JobManager {
    return {
        listJobs: vi.fn().mockResolvedValue([]),
        getJobDetails: vi.fn().mockResolvedValue(undefined),
        retryJob: vi.fn().mockResolvedValue(undefined),
        cancelJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobManager;
}

function makeMockNoteService(): NoteService {
    return {
        regenerateNote: vi.fn().mockResolvedValue({ templateUsed: NoteTemplate.STD_MEETING }),
    } as unknown as NoteService;
}

function makeMockFileManager(): IFileManager {
    return {
        readFile: vi.fn().mockResolvedValue('file content'),
        writeFile: vi.fn().mockResolvedValue(undefined),
        fileExists: vi.fn().mockResolvedValue(true),
        joinPathsInProjectFolder: vi.fn((...parts: string[]) => parts.join('/')),
        joinPaths: vi.fn((...parts: string[]) => parts.join('/')),
    };
}

describe('Jobs Hub Command', () => {
    let mockJobManager: JobManager;
    let mockNoteService: NoteService;
    let mockFileManager: IFileManager;
    const mockPrompt = vi.mocked(inquirer.prompt);

    beforeEach(() => {
        vi.clearAllMocks();
        mockJobManager = makeMockJobManager();
        mockNoteService = makeMockNoteService();
        mockFileManager = makeMockFileManager();
    });

    it('should show friendly empty state when there are no jobs', async () => {
        vi.mocked(mockJobManager.listJobs).mockResolvedValueOnce([]);
        // User selects "Back to menu" immediately
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.listJobs).toHaveBeenCalled();
    });

    it('should list jobs and allow user to select one', async () => {
        const jobs = [
            makeJob({ id: 'job-1', originalFilename: 'sprint.wav', clientStatus: ClientJobStatus.COMPLETED }),
            makeJob({ id: 'job-2', originalFilename: 'standup.wav', clientStatus: ClientJobStatus.FAILED }),
        ];
        vi.mocked(mockJobManager.listJobs).mockResolvedValue(jobs);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: jobs[0],
            summary: 'Summary text',
            transcript: 'Transcript text',
        });

        // First prompt: select job-1
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-1' });
        // Second prompt: action = back to list
        mockPrompt.mockResolvedValueOnce({ action: 'back' });
        // Third prompt: back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.listJobs).toHaveBeenCalled();
        expect(mockJobManager.getJobDetails).toHaveBeenCalledWith('job-1');
    });

    it('should show View Summary and View Transcript for COMPLETED jobs', async () => {
        const completedJob = makeJob({ id: 'job-c', clientStatus: ClientJobStatus.COMPLETED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([completedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: completedJob,
            summary: 'Meeting summary here',
            transcript: 'Full transcript here',
        });

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-c' });
        // Choose "View Summary"
        mockPrompt.mockResolvedValueOnce({ action: 'view-summary' });
        // Back to list
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.getJobDetails).toHaveBeenCalledWith('job-c');
    });

    it('should show Retry action for FAILED jobs', async () => {
        const failedJob = makeJob({ id: 'job-f', clientStatus: ClientJobStatus.FAILED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([failedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: failedJob,
        });

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-f' });
        // Choose "Retry"
        mockPrompt.mockResolvedValueOnce({ action: 'retry' });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.retryJob).toHaveBeenCalledWith('job-f');
    });

    it('should show Retry action for ABANDONED jobs', async () => {
        const abandonedJob = makeJob({ id: 'job-a', clientStatus: ClientJobStatus.ABANDONED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([abandonedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: abandonedJob,
        });

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-a' });
        // Choose "Retry"
        mockPrompt.mockResolvedValueOnce({ action: 'retry' });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.retryJob).toHaveBeenCalledWith('job-a');
    });

    it('should show Cancel action for WAITING_UPLOAD jobs', async () => {
        const waitingJob = makeJob({ id: 'job-w', clientStatus: ClientJobStatus.WAITING_UPLOAD });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([waitingJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: waitingJob,
        });

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-w' });
        // Choose "Cancel"
        mockPrompt.mockResolvedValueOnce({ action: 'cancel' });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.cancelJob).toHaveBeenCalledWith('job-w');
    });

    it('should handle retry errors gracefully and stay in hub', async () => {
        const failedJob = makeJob({ id: 'job-err', clientStatus: ClientJobStatus.FAILED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([failedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: failedJob,
        });
        vi.mocked(mockJobManager.retryJob).mockRejectedValueOnce(new Error('DB write failed'));

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-err' });
        // Choose "Retry"
        mockPrompt.mockResolvedValueOnce({ action: 'retry' });
        // Back to menu (should still be in hub after error)
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        // Should not throw — error is caught internally
        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.retryJob).toHaveBeenCalledWith('job-err');
    });

    it('should handle cancel errors gracefully and stay in hub', async () => {
        const waitingJob = makeJob({ id: 'job-cerr', clientStatus: ClientJobStatus.WAITING_UPLOAD });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([waitingJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: waitingJob,
        });
        vi.mocked(mockJobManager.cancelJob).mockRejectedValueOnce(new Error('Invalid state'));

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-cerr' });
        // Choose "Cancel"
        mockPrompt.mockResolvedValueOnce({ action: 'cancel' });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.cancelJob).toHaveBeenCalledWith('job-cerr');
    });

    it('should regenerate note with selected template for COMPLETED jobs', async () => {
        const completedJob = makeJob({ id: 'job-regen', clientStatus: ClientJobStatus.COMPLETED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([completedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: completedJob,
            summary: 'Summary',
            transcript: 'Transcript',
        });

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-regen' });
        // Choose "Regenerate Note"
        mockPrompt.mockResolvedValueOnce({ action: 'regenerate' });
        // Select template
        mockPrompt.mockResolvedValueOnce({ template: NoteTemplate.TRAINING });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockNoteService.regenerateNote).toHaveBeenCalledWith(
            completedJob,
            NoteTemplate.TRAINING,
            mockFileManager
        );
    });

    it('should handle regenerate errors gracefully', async () => {
        const completedJob = makeJob({ id: 'job-regen-err', clientStatus: ClientJobStatus.COMPLETED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([completedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: completedJob,
            summary: 'Summary',
        });
        vi.mocked(mockNoteService.regenerateNote).mockRejectedValueOnce(new Error('File not found'));

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-regen-err' });
        // Choose "Regenerate Note"
        mockPrompt.mockResolvedValueOnce({ action: 'regenerate' });
        // Select template
        mockPrompt.mockResolvedValueOnce({ template: NoteTemplate.STD_MEETING });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockNoteService.regenerateNote).toHaveBeenCalled();
    });

    it('should handle job not found between list and detail view', async () => {
        const job = makeJob({ id: 'job-gone' });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([job]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce(undefined);

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-gone' });
        // Back to menu (should return to list after "not found")
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.getJobDetails).toHaveBeenCalledWith('job-gone');
    });

    it('should view transcript for COMPLETED jobs', async () => {
        const completedJob = makeJob({ id: 'job-t', clientStatus: ClientJobStatus.COMPLETED });
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([completedJob]);
        vi.mocked(mockJobManager.getJobDetails).mockResolvedValueOnce({
            job: completedJob,
            summary: 'Summary text',
            transcript: 'Full transcript text here',
        });

        // Select the job
        mockPrompt.mockResolvedValueOnce({ selectedJobId: 'job-t' });
        // Choose "View Transcript"
        mockPrompt.mockResolvedValueOnce({ action: 'view-transcript' });
        // Back to menu
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        expect(mockJobManager.getJobDetails).toHaveBeenCalledWith('job-t');
    });

    it('should exit the hub loop when user selects back to menu', async () => {
        vi.mocked(mockJobManager.listJobs).mockResolvedValue([makeJob()]);

        // Immediately select back
        mockPrompt.mockResolvedValueOnce({ selectedJobId: '__back__' });

        await jobsHubCommand(mockJobManager, mockNoteService, mockFileManager);

        // Should have called listJobs once and then exited
        expect(mockJobManager.listJobs).toHaveBeenCalledTimes(1);
    });
});
