import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoteService } from '../../src/services/note';
import { ClientJob, ClientJobStatus } from '../../src/domain/clientJob';
import { AIPromptTemplate, TranscriptionLanguage } from '@meeting-summarizer/shared';

describe('NoteService.saveNote', () => {
  it('should format the meeting template and write the file to the Obsidian vault', async () => {
    // 1. Arrange
    const mockFs = { writeFile: vi.fn() };
    const config = { vaultPath: '/Users/test/Documents/Obsidian', notesFolder: 'Meetings' };
    const service = new NoteService(mockFs, config);

    const mockJob: ClientJob = {
      jobId: '123',
      filePath: '/raw/audio.mp3',
      originalFilename: 'Q1_Planning_Meeting.mp3',
      status: ClientJobStatus.READY,
      retryCount: 0,
      createdAt: '2026-02-23T10:00:00Z',
      options: {
        language: TranscriptionLanguage.PORTUGUESE,
        template: AIPromptTemplate.MEETING
      }
    };

    const summary = "Discussed Q1 roadmap. Decided to launch V2 in April.";
    const transcript = "Speaker 1: Welcome everyone...";

    // 2. Act
    await service.saveNote(mockJob, summary, transcript);

    // 3. Assert
    const expectedPath = '/Users/test/Documents/Obsidian/Meetings/Q1_Planning_Meeting.md';
    const expectedContent = expect.stringContaining(summary);
    
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFile).toHaveBeenCalledWith(expectedPath, expectedContent);
    expect(mockFs.writeFile).toHaveBeenCalledWith(expectedPath, expect.stringContaining(transcript));
  });
});