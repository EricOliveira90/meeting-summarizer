import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoteService } from '../../src/services/note';
import { ClientJob, ClientJobStatus, NoteTemplate } from '../../src/domain';
import { AIPromptTemplate, TranscriptionLanguage } from '@meeting-summarizer/shared';

describe('NoteService - Regeneration', () => {
    let mockFs: any;
    let mockDb: any;
    const config: any = { vaultPath: '/Users/test/Documents/Obsidian', notesFolder: 'Meetings' };
    let note: NoteService;

    beforeEach(() => {
        mockFs = {
            writeFile: vi.fn(),
            readFile: vi.fn(),
            fileExists: vi.fn().mockResolvedValue(true),
            joinPaths: vi.fn().mockImplementation((...parts: string[]) => parts.join('/')),
            joinPathsInProjectFolder: vi.fn().mockImplementation((...parts: string[]) => parts.join('/'))
        };

        mockDb = {
            updateOptions: vi.fn(),
            getAll: vi.fn().mockResolvedValue([]),
        };

        note = new NoteService(mockFs, config);
    });

    const createCompletedJob = (overrides?: Partial<ClientJob>): ClientJob => ({
        id: 'job-1',
        filePath: '/raw/audio.mp3',
        originalFilename: 'Sprint_Planning.mp3',
        clientStatus: ClientJobStatus.COMPLETED,
        retryCount: 0,
        recordedAt: '2026-02-23T10:00:00Z',
        options: {
            language: TranscriptionLanguage.ENGLISH,
            template: AIPromptTemplate.MEETING
        },
        noteTemplate: NoteTemplate.STD_MEETING,
        ...overrides
    });

    describe('regenerateNote()', () => {
        it('should re-render a note from local summary/transcript files with a new template', async () => {
            const job = createCompletedJob();
            mockFs.readFile.mockResolvedValueOnce('Summary content here');
            mockFs.readFile.mockResolvedValueOnce('Transcript content here');

            await note.regenerateNote(job, NoteTemplate.TRAINING, mockFs);

            // Should read summary and transcript files
            expect(mockFs.readFile).toHaveBeenCalledTimes(2);

            // Should write the note with the new template
            expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
            const writtenContent = mockFs.writeFile.mock.calls[0][1];
            expect(writtenContent).toContain('Summary content here');
        });

        it('should use the SELLER_MEETING template when explicitly selected', async () => {
            const job = createCompletedJob();
            mockFs.readFile.mockResolvedValueOnce('Summary');
            mockFs.readFile.mockResolvedValueOnce('Transcript');

            await note.regenerateNote(job, NoteTemplate.SELLER_MEETING, mockFs);

            const writtenContent = mockFs.writeFile.mock.calls[0][1];
            // SELLER_MEETING template has a 'seller:' field
            expect(writtenContent).toContain('seller:');
        });

        it('should work even if the transcript file does not exist', async () => {
            const job = createCompletedJob();
            mockFs.readFile.mockResolvedValueOnce('Summary only');
            mockFs.fileExists
                .mockResolvedValueOnce(true)   // summary exists
                .mockResolvedValueOnce(false);  // transcript missing

            await note.regenerateNote(job, NoteTemplate.SUMMARY, mockFs);

            expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
            const writtenContent = mockFs.writeFile.mock.calls[0][1];
            expect(writtenContent).toContain('Summary only');
        });

        it('should work even if the original note file was deleted', async () => {
            const job = createCompletedJob();
            mockFs.readFile.mockResolvedValueOnce('Regenerated summary');
            mockFs.readFile.mockResolvedValueOnce('Regenerated transcript');

            // This should not throw even if the note doesn't exist yet
            await expect(
                note.regenerateNote(job, NoteTemplate.STD_MEETING, mockFs)
            ).resolves.not.toThrow();

            expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
        });

        it('should return the selected template for the caller to persist', async () => {
            const job = createCompletedJob({ noteTemplate: NoteTemplate.STD_MEETING });
            mockFs.readFile.mockResolvedValueOnce('Summary');
            mockFs.readFile.mockResolvedValueOnce('Transcript');

            const result = await note.regenerateNote(job, NoteTemplate.TRAINING, mockFs);

            expect(result.templateUsed).toBe(NoteTemplate.TRAINING);
        });
    });
});
