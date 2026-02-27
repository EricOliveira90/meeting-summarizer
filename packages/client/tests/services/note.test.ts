import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoteService } from '../../src/services/note';
import { ClientJob, ClientJobStatus, NoteTemplate } from '../../src/domain';
import { AIPromptTemplate, TranscriptionLanguage } from '@meeting-summarizer/shared';

describe('NoteService', () => {
  let mockFs: any;
  const config: any = { vaultPath: '/Users/test/Documents/Obsidian', notesFolder: 'Meetings' };
  let note: NoteService;

  beforeEach(() => {
    mockFs = { writeFile: vi.fn(), joinPaths: vi.fn() };
    note = new NoteService(mockFs, config);
  });

  it('should format the meeting template and write the file to the Obsidian vault', async () => {
    // 1. Arrange

    mockFs.joinPaths.mockReturnValueOnce('/Users/test/Documents/Obsidian/Meetings/Q1_Planning_Meeting.md')
    
    const mockJob: ClientJob = {
      id: '123',
      filePath: '/raw/audio.mp3',
      originalFilename: 'Q1_Planning_Meeting.mp3',
      clientStatus: ClientJobStatus.READY,
      retryCount: 0,
      recordedAt: '2026-02-23T10:00:00Z',
      options: {
        language: TranscriptionLanguage.PORTUGUESE,
        template: AIPromptTemplate.MEETING
      },
      noteTemplate: NoteTemplate.SUMMARY
    };

    const summary = "Discussed Q1 roadmap. Decided to launch V2 in April.";
    const transcript = "Speaker 1: Welcome everyone...";

    // 2. Act
    await note.saveNote(mockJob, summary, transcript);

    // 3. Assert
    const expectedPath = '/Users/test/Documents/Obsidian/Meetings/Q1_Planning_Meeting.md';
    
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFile).toHaveBeenCalledWith(expectedPath, expect.stringContaining(summary));
    expect(mockFs.writeFile).toHaveBeenCalledWith(expectedPath, expect.stringContaining(transcript));
  });
});