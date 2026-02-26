import inquirer from 'inquirer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/services/syncManager';
import { ClientJobStatus, SyncError } from '../../src/domain/clientJob';
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared';

// 1. Mock inquirer purely, without referencing external variables (avoids hoisting ReferenceError)
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn()
  }
}));

describe('SyncManager', () => {
  let mockApi: any;
  let mockDb: any;
  let mockNote: any;
  let mockIngestion: any;
  let mockFileSystem: any;
  let syncManager: SyncManager;

  beforeEach(() => {
    // 2. Safely set the mock return value after imports are loaded
    vi.mocked(inquirer.prompt).mockResolvedValue({
      language: TranscriptionLanguage.ENGLISH,
      template: AIPromptTemplate.MEETING,
      minSpeakers: 1,
      maxSpeakers: 3
    });

    // 3. Setup fresh mocks before each test
    mockApi = {
      uploadMeeting: vi.fn(),
      getJobStatus: vi.fn(),
    };

    mockDb = {
      getAll: vi.fn().mockResolvedValue([]),
      getReadyToFetch: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn(),
      setError: vi.fn(),
      resetJobForRetry: vi.fn(),
      updateOptions: vi.fn(),
      markCompleted: vi.fn()
    };

    mockNote = {
      saveNote: vi.fn()
    };

    mockIngestion = {
      scanDirectory: vi.fn().mockResolvedValue(undefined),
      ingestFile: vi.fn().mockResolvedValue(undefined)
    };

    // NEW: Initialize mockFileSystem
    mockFileSystem = {
      joinPathsInProjectFolder: vi.fn().mockImplementation((...parts: string[]) => parts.join('/')),
      writeFile: vi.fn().mockResolvedValue(undefined)
    };

    // NEW: Inject mockFileSystem into SyncManager
    syncManager = new SyncManager(mockApi, mockDb, mockNote, mockIngestion, mockFileSystem);
    vi.clearAllMocks();
  });

  describe('runFullSyncCycle() - Orchestration', () => {
    it('should execute the sync lifecycle in the correct order', async () => {
      // Arrange
      const ingestionSpy = vi.spyOn(mockIngestion as any, 'scanDirectory').mockResolvedValue(undefined);
      const updateSpy = vi.spyOn(syncManager as any, 'updateActiveStates').mockResolvedValue(undefined);
      const fetchSpy = vi.spyOn(syncManager as any, 'fetchResults').mockResolvedValue(undefined);
      const pushSpy = vi.spyOn(syncManager as any, 'pushPending').mockResolvedValue(undefined);

      // Act
      await syncManager.runFullSyncCycle();

      // Assert
      expect(ingestionSpy).toHaveBeenCalledOnce();
      expect(updateSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(pushSpy).toHaveBeenCalledOnce();
      
      expect(ingestionSpy.mock.invocationCallOrder[0]).toBeLessThan(updateSpy.mock.invocationCallOrder[0]);
      expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(fetchSpy.mock.invocationCallOrder[0]);
      expect(fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(pushSpy.mock.invocationCallOrder[0]);
    });
  });

  describe('pushJob() - Single Job Upload Logic', () => {
    
    it('should correctly handle a TRANSIENT network error (e.g. Tunnel Down)', async () => {
      // Arrange
      const fakeJob = { jobId: '123', status: ClientJobStatus.WAITING_UPLOAD, originalFilename: 'test.mkv', language: 'en', template: 'meeting' } as any;
      mockApi.uploadMeeting.mockRejectedValue(new SyncError('ECONNRESET', true));

      // Act
      await syncManager.pushJob(fakeJob);

      // Assert
      expect(mockDb.updateStatus).toHaveBeenCalledWith('123', ClientJobStatus.UPLOADING);
      expect(mockDb.setError).toHaveBeenCalledWith('123', 'ECONNRESET', false);
    });

    it('should correctly handle a FATAL auth error (e.g. Bad API Key)', async () => {
      // Arrange
      const fakeJob = { jobId: '123', status: ClientJobStatus.WAITING_UPLOAD, originalFilename: 'test.mkv', language: 'en', template: 'meeting' } as any;
      mockApi.uploadMeeting.mockRejectedValue(new SyncError('Unauthorized', false, 401));

      // Act
      await syncManager.pushJob(fakeJob);

      // Assert
      expect(mockDb.setError).toHaveBeenCalledWith('123', 'Unauthorized', true);
    });

    it('should prompt for configuration if missing and save it to the DB', async () => {
      // Arrange
      const fakeJob = { jobId: '124', status: ClientJobStatus.WAITING_UPLOAD, originalFilename: 'test.mkv' } as any;
      mockApi.uploadMeeting.mockResolvedValue({ success: true });

      // Act
      await syncManager.pushJob(fakeJob);

      // Assert
      expect(mockDb.updateOptions).toHaveBeenCalledWith(
          '124',
          {
            language: TranscriptionLanguage.ENGLISH, 
            template: AIPromptTemplate.MEETING, 
            minSpeakers: 1, 
            maxSpeakers: 3
          }
      );
    });
  });

  describe('pushPending() - Batch Processor Logic', () => {
    it('should filter targets correctly and delegate to pushJob', async () => {
      // Arrange
      const waitingJob = { jobId: '1', status: ClientJobStatus.WAITING_UPLOAD };
      const retryJob = { jobId: '2', status: ClientJobStatus.FAILED, retryCount: 1 };
      const maxRetryJob = { jobId: '3', status: ClientJobStatus.FAILED, retryCount: 3 }; // Should skip (Max Retries)
      const readyJob = { jobId: '4', status: ClientJobStatus.READY }; // Should skip (Wrong Status)
      
      mockDb.getAll.mockResolvedValue([waitingJob, retryJob, maxRetryJob, readyJob]);
      const pushSpy = vi.spyOn(syncManager, 'pushJob').mockResolvedValue(undefined);

      // Act
      await syncManager['pushPending']();

      // Assert
      expect(pushSpy).toHaveBeenCalledTimes(2);
      expect(pushSpy).toHaveBeenCalledWith(waitingJob);
      expect(pushSpy).toHaveBeenCalledWith(retryJob);
      expect(pushSpy).not.toHaveBeenCalledWith(maxRetryJob);
    });
  });

  describe('updateActiveStates() - Polling Logic', () => {
    
    it('should mark job as FAILED (fatal) if the server processing fails', async () => {
      // Arrange
      const fakeJob = { jobId: '456', status: ClientJobStatus.PROCESSING };
      mockDb.getAll.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockResolvedValue({ status: 'FAILED', error: 'Whisper CUDA out of memory' });

      // Act
      await syncManager['updateActiveStates']();

      // Assert
      expect(mockDb.setError).toHaveBeenCalledWith('456', 'Whisper CUDA out of memory', true);
    });

    it('should quietly ignore errors if the server is simply unreachable (Tunnel Down)', async () => {
      // Arrange
      const fakeJob = { jobId: '456', status: ClientJobStatus.PROCESSING };
      mockDb.getAll.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockRejectedValue(new Error('Network timeout'));

      // Act
      await syncManager['updateActiveStates']();

      // Assert
      expect(mockDb.updateStatus).not.toHaveBeenCalled();
      expect(mockDb.setError).not.toHaveBeenCalled();
    });
  });

  describe('fetchResults() - Download Logic', () => {
    
    it('should save notes and mark as completed when payloads exist', async () => {
      // Arrange
      // FIXED: Added originalFilename to prevent regex crash
      const fakeJob = { jobId: '789', status: ClientJobStatus.READY, originalFilename: 'meeting.mkv' };
      mockDb.getReadyToFetch.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockResolvedValue({ 
        jobId: '789', 
        summaryText: '# Meeting Summary', 
        transcriptText: 'Hello world' 
      });

      // Act
      await syncManager['fetchResults']();

      // Assert
      expect(mockNote.saveNote).toHaveBeenCalledWith(fakeJob, '# Meeting Summary', 'Hello world');
      expect(mockDb.markCompleted).toHaveBeenCalledWith('789');
    });

    it('should save the transcript and summary to local .txt files to keep the DB lean', async () => {
      // Arrange
      const fakeJob = { 
        jobId: '999', 
        status: ClientJobStatus.READY, 
        originalFilename: 'Q3_Planning_Meeting.mp3' 
      };
      mockDb.getReadyToFetch.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockResolvedValue({ 
        jobId: '999', 
        summaryText: 'Summary content', 
        transcriptText: 'Transcript content' 
      });

      // Act
      await syncManager['fetchResults']();
    
      // Assert      
      // 1. Verify path construction checks for the upward traversal and new file suffixes
      expect(mockFileSystem.joinPathsInProjectFolder).toHaveBeenCalledWith('summaries', 'Q3_Planning_Meeting_summary.txt');
      expect(mockFileSystem.joinPathsInProjectFolder).toHaveBeenCalledWith('transcriptions', 'Q3_Planning_Meeting_transcription.txt');

      // 2. Verify file system writes (mockFileSystem.joinPathsInProjectFolder joins with '/' in our mock setup)
      const expectedSummaryPath = ['summaries', 'Q3_Planning_Meeting_summary.txt'].join('/');
      const expectedTranscriptPath = ['transcriptions', 'Q3_Planning_Meeting_transcription.txt'].join('/');
      
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(expectedSummaryPath, 'Summary content');
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(expectedTranscriptPath, 'Transcript content');
      
      // 3. Ensure the DB is just marked completed, without storing the text
      expect(mockDb.markCompleted).toHaveBeenCalledWith('999');
    });
  });
});