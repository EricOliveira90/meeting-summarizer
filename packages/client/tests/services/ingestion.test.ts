import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IngestionService } from '../../src/services/ingestion';
import { configService } from '../../src/services/config';
import { promptForMeetingTitle, promptForJobConfig } from '../../src/ui/prompts';
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared';

// 1. Mock external dependencies
vi.mock('fs');
vi.mock('../../src/services/config', () => ({
    configService: { get: vi.fn() }
}));
vi.mock('../../src/ui/prompts', () => ({
    promptForMeetingTitle: vi.fn(),
    promptForJobConfig: vi.fn()
}));

describe('IngestionService', () => {
    let mockDb: any;
    let ingestionService: IngestionService;
    let dateNowSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();

        // Mute the console during tests
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        // 2. Safely break the synchronous "busy wait" loop
        // If we don't advance time artificially, the `while (Date.now() < stopUntil)` 
        // will become an infinite loop in our mock environment.
        let fakeTime = 0;
        dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            fakeTime += 2000; // Jump 2 seconds ahead every time Date.now() is checked
            return fakeTime;
        });

        mockDb = {
            getJobByPath: vi.fn(),
            addRecording: vi.fn().mockResolvedValue({ jobId: 'job-123' }),
            updateOptions: vi.fn()
        };

        // Setup base config output path
        vi.mocked(configService.get).mockReturnValue({ output: '/mock/output/dir' });
        
        // Assume directory exists by default
        vi.mocked(fs.existsSync).mockReturnValue(true);

        ingestionService = new IngestionService(mockDb);
    });

    afterEach(() => {
        dateNowSpy.mockRestore();
    });

    describe('scanDirectory()', () => {
        it('should correctly filter extensions and skip already tracked files', async () => {
            // Arrange
            const mockFiles = [
                'video.mkv',       // Should ingest
                'audio.mp3',       // Should ingest
                'notes.txt',       // Should ignore (bad extension)
                'tracked.wav'      // Should ignore (already in DB)
            ];
            vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);

            // Mock DB to return a job ONLY for 'tracked.wav'
            mockDb.getJobByPath.mockImplementation((filePath: string) => {
                if (filePath.includes('tracked.wav')) return { jobId: 'existing-job' };
                return undefined;
            });

            // Spy on ingestFile so we can verify what gets passed to it
            const ingestSpy = vi.spyOn(ingestionService, 'ingestFile').mockResolvedValue(undefined);

            // Act
            await ingestionService.scanDirectory();

            // Assert
            expect(ingestSpy).toHaveBeenCalledTimes(2);
            expect(ingestSpy).toHaveBeenCalledWith(path.join('/mock/output/dir', 'video.mkv'));
            expect(ingestSpy).toHaveBeenCalledWith(path.join('/mock/output/dir', 'audio.mp3'));
        });

        it('should abort safely if the output directory does not exist', async () => {
            // Arrange
            vi.mocked(fs.existsSync).mockReturnValue(false);
            const ingestSpy = vi.spyOn(ingestionService, 'ingestFile');

            // Act
            await ingestionService.scanDirectory();

            // Assert
            expect(fs.readdirSync).not.toHaveBeenCalled();
            expect(ingestSpy).not.toHaveBeenCalled();
        });
    });

    describe('ingestFile() & renameWithRetry()', () => {
        beforeEach(() => {
            // Setup default prompt answers
            vi.mocked(promptForMeetingTitle).mockResolvedValue('My Team Sync');
            vi.mocked(promptForJobConfig).mockResolvedValue({
                language: TranscriptionLanguage.ENGLISH,
                template: AIPromptTemplate.MEETING
            });
        });

        it('should execute the full ingestion flow on a happy path', async () => {
            // Arrange
            const oldPath = path.join('/mock/output/dir', 'raw_obs_recording.mkv');
            vi.mocked(fs.renameSync).mockReturnValue(undefined); // Success

            // Act
            await ingestionService.ingestFile(oldPath);

            // Assert
            // 1. Prompts were called
            expect(promptForMeetingTitle).toHaveBeenCalledOnce();
            expect(promptForJobConfig).toHaveBeenCalledOnce();

            // 2. File was renamed (checking that sanitized title was used)
            const renameCallArg = vi.mocked(fs.renameSync).mock.calls[0][1];
            expect(renameCallArg.toString()).toContain('My_Team_Sync.mkv');

            // 3. Database was updated
            expect(mockDb.addRecording).toHaveBeenCalledOnce();
            expect(mockDb.updateOptions).toHaveBeenCalledWith('job-123', {
                language: TranscriptionLanguage.ENGLISH,
                template: AIPromptTemplate.MEETING
            });
        });

        it('should retry on Windows EBUSY errors and succeed if unlocked within max attempts', async () => {
            // Arrange
            const oldPath = path.join('/mock/output/dir', 'locked.mkv');
            
            // Mock renameSync to fail twice with EBUSY, then succeed
            const ebusyError = new Error('File locked') as any;
            ebusyError.code = 'EBUSY';
            
            vi.mocked(fs.renameSync)
                .mockImplementationOnce(() => { throw ebusyError; }) // Attempt 1
                .mockImplementationOnce(() => { throw ebusyError; }) // Attempt 2
                .mockImplementationOnce(() => undefined);            // Attempt 3 (Success)

            // Act
            await ingestionService.ingestFile(oldPath);

            // Assert
            expect(fs.renameSync).toHaveBeenCalledTimes(3);
            expect(mockDb.addRecording).toHaveBeenCalledOnce(); // Still successfully added to DB
        });

        it('should abort ingestion completely if file remains locked after max attempts', async () => {
            // Arrange
            const oldPath = path.join('/mock/output/dir', 'locked.mkv');
            
            const ebusyError = new Error('File locked') as any;
            ebusyError.code = 'EBUSY';
            
            // Fails all 3 attempts
            vi.mocked(fs.renameSync).mockImplementation(() => { throw ebusyError; });

            // Act
            await ingestionService.ingestFile(oldPath);

            // Assert
            expect(fs.renameSync).toHaveBeenCalledTimes(3);
            expect(mockDb.addRecording).not.toHaveBeenCalled(); // Aborted
            expect(mockDb.updateOptions).not.toHaveBeenCalled(); // Aborted
        });
    });
});