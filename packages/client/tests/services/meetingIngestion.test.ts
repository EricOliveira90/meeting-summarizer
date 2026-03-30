import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { IngestionService } from '../../src/services/ingestion';
import { configService } from '../../src/services/config';
import { promptForMeetingTitle, promptForJobConfig } from '../../src/ui/prompts';
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared';
import { MeetingStatus, NoteTemplate } from '../../src/domain/models';

// Mock external dependencies
vi.mock('fs');
vi.mock('../../src/services/config', () => ({
    configService: { get: vi.fn() }
}));
vi.mock('../../src/ui/prompts', () => ({
    promptForMeetingTitle: vi.fn(),
    promptForJobConfig: vi.fn()
}));

describe('IngestionService - Meeting-Linked Ingestion', () => {
    let mockDb: any;
    let ingestionService: IngestionService;
    let dateNowSpy: any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});

        let fakeTime = 0;
        dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
            fakeTime += 2000;
            return fakeTime;
        });

        mockDb = {
            getJobByPath: vi.fn(),
            addRecording: vi.fn().mockResolvedValue({ id: 'job-123' }),
            updateOptions: vi.fn()
        };

        vi.mocked(configService.get).mockReturnValue({ output: '/mock/output/dir' });
        vi.mocked(fs.existsSync).mockReturnValue(true);

        ingestionService = new IngestionService(mockDb);
    });

    afterEach(() => {
        dateNowSpy.mockRestore();
    });

    describe('ingestFileWithMeeting()', () => {
        it('should pull config from meeting entity instead of prompting when meeting is linked', async () => {
            const oldPath = path.join('/mock/output/dir', 'recording.mkv');
            vi.mocked(fs.renameSync).mockReturnValue(undefined);

            const meeting = {
                id: 'meeting-1',
                title: 'Sprint Planning',
                scheduledAt: '2026-04-01T10:00:00Z',
                language: TranscriptionLanguage.ENGLISH,
                aiTemplate: AIPromptTemplate.MEETING,
                attendees: ['Alice', 'Bob'],
                minSpeakers: 2,
                maxSpeakers: 4,
                status: MeetingStatus.RECORDED,
                createdAt: '2026-03-30T10:00:00Z'
            };

            await ingestionService.ingestFileWithMeeting(oldPath, meeting);

            // Should NOT prompt for title or config
            expect(promptForMeetingTitle).not.toHaveBeenCalled();
            expect(promptForJobConfig).not.toHaveBeenCalled();

            // Should use meeting's config for upload options
            expect(mockDb.updateOptions).toHaveBeenCalledWith('job-123', {
                language: TranscriptionLanguage.ENGLISH,
                template: AIPromptTemplate.MEETING,
                minSpeakers: 2,
                maxSpeakers: 4
            });
        });

        it('should set the noteTemplate on the job based on AI template mapping', async () => {
            const oldPath = path.join('/mock/output/dir', 'training.mkv');
            vi.mocked(fs.renameSync).mockReturnValue(undefined);

            const meeting = {
                id: 'meeting-2',
                title: 'Training Session',
                scheduledAt: '2026-04-01T10:00:00Z',
                language: TranscriptionLanguage.AUTO,
                aiTemplate: AIPromptTemplate.TRAINING,
                attendees: [],
                status: MeetingStatus.RECORDED,
                createdAt: '2026-03-30T10:00:00Z'
            };

            const result = await ingestionService.ingestFileWithMeeting(oldPath, meeting);

            expect(result).toBeDefined();
            expect(result!.meetingId).toBe('meeting-2');
            expect(result!.noteTemplate).toBe(NoteTemplate.TRAINING);
        });

        it('should use meeting title for file renaming instead of prompting', async () => {
            const oldPath = path.join('/mock/output/dir', 'raw_obs.mkv');
            vi.mocked(fs.renameSync).mockReturnValue(undefined);

            const meeting = {
                id: 'meeting-3',
                title: 'Quarterly Review',
                scheduledAt: '2026-04-01T10:00:00Z',
                language: TranscriptionLanguage.AUTO,
                aiTemplate: AIPromptTemplate.MEETING,
                attendees: [],
                status: MeetingStatus.RECORDED,
                createdAt: '2026-03-30T10:00:00Z'
            };

            await ingestionService.ingestFileWithMeeting(oldPath, meeting);

            // File should be renamed with meeting title
            const renameCallArg = vi.mocked(fs.renameSync).mock.calls[0][1];
            expect(renameCallArg.toString()).toContain('Quarterly_Review');
        });
    });

    describe('orphan file ingestion', () => {
        it('should still prompt for config when no meeting is linked (orphan path)', async () => {
            const oldPath = path.join('/mock/output/dir', 'orphan.mkv');
            vi.mocked(fs.renameSync).mockReturnValue(undefined);
            vi.mocked(promptForMeetingTitle).mockResolvedValue('Orphan Meeting');
            vi.mocked(promptForJobConfig).mockResolvedValue({
                language: TranscriptionLanguage.ENGLISH,
                template: AIPromptTemplate.MEETING
            });

            await ingestionService.ingestFile(oldPath);

            // Should prompt for both title and config
            expect(promptForMeetingTitle).toHaveBeenCalledOnce();
            expect(promptForJobConfig).toHaveBeenCalledOnce();
        });
    });
});
