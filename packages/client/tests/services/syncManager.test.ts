import inquirer from 'inquirer';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/services/syncManager';
import { ClientJobStatus, SyncError } from '../../src/domain';
import {
  TranscriptionLanguage,
  AIPromptTemplate,
  JobStep
} from '@meeting-summarizer/shared';

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
      getTranscript: vi.fn(),
      getJobStatus: vi.fn().mockRejectedValue(
        new SyncError('Job was not found.', false, 404, 'JOB_NOT_FOUND')
      ),
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
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      renameFile: vi.fn().mockResolvedValue(undefined),
      deleteFile: vi.fn().mockResolvedValue(undefined)
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
    it.each([
      {
        lookupError: new SyncError('Tunnel unavailable', true),
        expectedStatus: ClientJobStatus.FAILED,
        expectedRetryCount: 2,
        expectedFatal: false
      },
      {
        lookupError: new SyncError('Server unavailable', true, 500, 'INTERNAL_ERROR'),
        expectedStatus: ClientJobStatus.FAILED,
        expectedRetryCount: 2,
        expectedFatal: false
      },
      {
        lookupError: new SyncError('Invalid API Key', false, 401, 'AUTH_INVALID'),
        expectedStatus: ClientJobStatus.ABANDONED,
        expectedRetryCount: 1,
        expectedFatal: true
      },
      {
        lookupError: new SyncError('Unexpected missing response', false, 404, 'OTHER_NOT_FOUND'),
        expectedStatus: ClientJobStatus.ABANDONED,
        expectedRetryCount: 1,
        expectedFatal: true
      }
    ])('maps lookup failure $lookupError.message without creating', async ({
      lookupError,
      expectedStatus,
      expectedRetryCount,
      expectedFatal
    }) => {
      const fakeJob = {
        id: 'job-123',
        filePath: 'C:/recordings/meeting.wav',
        originalFilename: 'meeting.wav',
        recordedAt: '2026-08-20T09:30:00-03:00',
        clientStatus: ClientJobStatus.FAILED,
        retryCount: 1,
        options: {
          language: TranscriptionLanguage.ENGLISH,
          template: AIPromptTemplate.MEETING
        }
      } as any;
      mockApi.getJobStatus.mockRejectedValueOnce(lookupError);
      mockDb.setError.mockImplementation(async (_id: string, message: string, isFatal: boolean) => {
        fakeJob.error = message;
        if (isFatal) {
          fakeJob.clientStatus = ClientJobStatus.ABANDONED;
        } else {
          fakeJob.clientStatus = ClientJobStatus.FAILED;
          fakeJob.retryCount += 1;
        }
      });

      await syncManager.pushJob(fakeJob);

      expect(mockApi.uploadMeeting).not.toHaveBeenCalled();
      expect(mockDb.setError).toHaveBeenCalledWith(
        'job-123',
        lookupError.message,
        expectedFatal
      );
      expect(fakeJob).toMatchObject({
        clientStatus: expectedStatus,
        retryCount: expectedRetryCount,
        error: lookupError.message
      });
    });

    it.each([
      {
        serverJob: { serverStatus: 'PENDING', currentStep: JobStep.QUEUED },
        expectedStatus: ClientJobStatus.PROCESSING
      },
      {
        serverJob: { serverStatus: 'PROCESSING', currentStep: JobStep.TRANSCRIBING },
        expectedStatus: ClientJobStatus.PROCESSING
      },
      {
        serverJob: { serverStatus: 'COMPLETED', currentStep: JobStep.TRANSCRIPT_READY },
        expectedStatus: ClientJobStatus.READY
      },
      {
        serverJob: {
          serverStatus: 'FAILED',
          currentStep: JobStep.TRANSCRIBING,
          error: 'Whisper failed'
        },
        expectedStatus: ClientJobStatus.ABANDONED,
        expectedError: 'Whisper failed'
      }
    ])('reconciles a found $serverJob.serverStatus Job without creating it', async ({
      serverJob,
      expectedStatus,
      expectedError
    }) => {
      const fakeJob = {
        id: 'job-123',
        filePath: 'C:/recordings/meeting.wav',
        originalFilename: 'meeting.wav',
        recordedAt: '2026-08-20T09:30:00-03:00',
        clientStatus: ClientJobStatus.FAILED,
        retryCount: 2,
        meetingId: 'meeting-456',
        options: {
          language: TranscriptionLanguage.ENGLISH,
          template: AIPromptTemplate.MEETING,
          minSpeakers: 2,
          maxSpeakers: 5
        }
      } as any;
      const persistedMetadata = {
        id: fakeJob.id,
        recordedAt: fakeJob.recordedAt,
        meetingId: fakeJob.meetingId,
        options: fakeJob.options
      };
      mockApi.getJobStatus.mockResolvedValueOnce(serverJob);
      mockDb.updateStatus.mockImplementation(async (_id: string, status: ClientJobStatus) => {
        fakeJob.clientStatus = status;
      });
      mockDb.setError.mockImplementation(async (_id: string, message: string, isFatal: boolean) => {
        fakeJob.error = message;
        if (isFatal) fakeJob.clientStatus = ClientJobStatus.ABANDONED;
      });

      await syncManager.pushJob(fakeJob);

      expect(mockApi.uploadMeeting).not.toHaveBeenCalled();
      expect(fakeJob).toMatchObject({
        ...persistedMetadata,
        clientStatus: expectedStatus,
        retryCount: 2
      });
      if (expectedError) {
        expect(mockDb.setError).toHaveBeenCalledWith('job-123', expectedError, true);
      } else {
        expect(mockDb.setError).not.toHaveBeenCalled();
      }
    });

    it('creates once after exact absence without changing persisted Job metadata', async () => {
      const fakeJob = {
        id: 'job-123',
        filePath: 'C:/recordings/meeting.wav',
        originalFilename: 'meeting.wav',
        recordedAt: '2026-08-20T09:30:00-03:00',
        clientStatus: ClientJobStatus.WAITING_UPLOAD,
        retryCount: 2,
        meetingId: 'meeting-456',
        options: {
          language: TranscriptionLanguage.ENGLISH,
          template: AIPromptTemplate.MEETING,
          minSpeakers: 2,
          maxSpeakers: 5
        }
      } as any;
      const persistedMetadata = {
        id: fakeJob.id,
        recordedAt: fakeJob.recordedAt,
        meetingId: fakeJob.meetingId,
        options: fakeJob.options
      };
      mockApi.uploadMeeting.mockResolvedValue({
        success: true,
        jobId: 'job-123',
        message: 'File queued.'
      });
      mockDb.updateStatus.mockImplementation(async (_id: string, status: ClientJobStatus) => {
        fakeJob.clientStatus = status;
      });
      mockDb.resetJobForRetry.mockImplementation(async () => {
        fakeJob.clientStatus = ClientJobStatus.WAITING_UPLOAD;
        fakeJob.retryCount = 0;
      });

      await syncManager.pushJob(fakeJob);

      expect(mockApi.getJobStatus).toHaveBeenCalledOnce();
      expect(mockApi.getJobStatus).toHaveBeenCalledWith('job-123');
      expect(mockApi.uploadMeeting).toHaveBeenCalledOnce();
      expect(mockApi.uploadMeeting).toHaveBeenCalledWith(
        'C:/recordings/meeting.wav',
        'job-123',
        '2026-08-20T09:30:00-03:00',
        fakeJob.options
      );
      expect(fakeJob).toMatchObject({
        ...persistedMetadata,
        clientStatus: ClientJobStatus.PROCESSING,
        retryCount: 0
      });
      expect(mockDb.updateOptions).not.toHaveBeenCalled();
    });
    
    it('should correctly handle a TRANSIENT network error (e.g. Tunnel Down)', async () => {
      // Arrange
      const fakeJob = { id: '123', clientStatus: ClientJobStatus.WAITING_UPLOAD, originalFilename: 'test.mkv', options: {language: 'en', template: 'meeting'} } as any;
      mockApi.uploadMeeting.mockRejectedValue(new SyncError('ECONNRESET', true));

      // Act
      await syncManager.pushJob(fakeJob);

      // Assert
      expect(mockDb.updateStatus).toHaveBeenCalledWith('123', ClientJobStatus.UPLOADING);
      expect(mockDb.setError).toHaveBeenCalledWith('123', 'ECONNRESET', false);
    });

    it('should correctly handle a FATAL auth error (e.g. Bad API Key)', async () => {
      // Arrange
      const fakeJob = { id: '123', clientStatus: ClientJobStatus.WAITING_UPLOAD, originalFilename: 'test.mkv', options: {language: 'en', template: 'meeting'} } as any;
      mockApi.uploadMeeting.mockRejectedValue(new SyncError('Unauthorized', false, 401));

      // Act
      await syncManager.pushJob(fakeJob);

      // Assert
      expect(mockDb.setError).toHaveBeenCalledWith('123', 'Unauthorized', true);
    });

    it('should prompt for configuration if missing and save it to the DB', async () => {
      // Arrange
      const fakeJob = {
        id: '124',
        filePath: 'C:/recordings/test.mkv',
        recordedAt: '2026-08-20T09:30:00-03:00',
        meetingId: 'meeting-456',
        clientStatus: ClientJobStatus.WAITING_UPLOAD,
        originalFilename: 'test.mkv'
      } as any;
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
      expect(mockApi.getJobStatus).toHaveBeenCalledWith('124');
      expect(mockApi.uploadMeeting).toHaveBeenCalledWith(
        'C:/recordings/test.mkv',
        '124',
        '2026-08-20T09:30:00-03:00',
        {
          language: TranscriptionLanguage.ENGLISH,
          template: AIPromptTemplate.MEETING,
          minSpeakers: 1,
          maxSpeakers: 3
        }
      );
      expect(fakeJob).toMatchObject({
        id: '124',
        recordedAt: '2026-08-20T09:30:00-03:00',
        meetingId: 'meeting-456'
      });
    });
  });

  describe('pushPending() - Batch Processor Logic', () => {
    it('should filter targets correctly and delegate to pushJob', async () => {
      // Arrange
      const waitingJob = { id: '1', clientStatus: ClientJobStatus.WAITING_UPLOAD };
      const retryJob = { id: '2', clientStatus: ClientJobStatus.FAILED, retryCount: 1 };
      const maxRetryJob = { id: '3', clientStatus: ClientJobStatus.FAILED, retryCount: 3 }; // Should skip (Max Retries)
      const readyJob = { id: '4', clientStatus: ClientJobStatus.READY }; // Should skip (Wrong Status)
      
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
    it('marks a Job READY only at server TRANSCRIPT_READY completion', async () => {
      const fakeJob = { id: 'ready-456', clientStatus: ClientJobStatus.PROCESSING };
      mockDb.getAll.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockResolvedValue({
        serverStatus: 'COMPLETED',
        currentStep: JobStep.TRANSCRIPT_READY
      });

      await syncManager['updateActiveStates']();

      expect(mockDb.updateStatus).toHaveBeenCalledWith(
        'ready-456',
        ClientJobStatus.READY
      );
    });

    it('does not treat a non-ready COMPLETED status body as a Transcript', async () => {
      const fakeJob = { id: 'not-ready-456', clientStatus: ClientJobStatus.PROCESSING };
      mockDb.getAll.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockResolvedValue({
        serverStatus: 'COMPLETED',
        currentStep: JobStep.TRANSCRIBING
      });

      await syncManager['updateActiveStates']();

      expect(mockDb.updateStatus).not.toHaveBeenCalled();
      expect(mockDb.setError).not.toHaveBeenCalled();
    });
    
    it('should mark job as FAILED (fatal) if the server processing fails', async () => {
      // Arrange
      const fakeJob = { id: '456', clientStatus: ClientJobStatus.PROCESSING };
      mockDb.getAll.mockResolvedValue([fakeJob]);
      mockApi.getJobStatus.mockResolvedValue({ serverStatus: 'FAILED', error: 'Whisper CUDA out of memory' });

      // Act
      await syncManager['updateActiveStates']();

      // Assert
      expect(mockDb.setError).toHaveBeenCalledWith('456', 'Whisper CUDA out of memory', true);
    });

    it('should quietly ignore errors if the server is simply unreachable (Tunnel Down)', async () => {
      // Arrange
      const fakeJob = { id: '456', clientStatus: ClientJobStatus.PROCESSING };
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
    it('atomically commits a verified Transcript and leaves the Job READY', async () => {
      const transcript = 'Speaker 1: Exact Transcript\nSpeaker 2: Confirmed';
      const fakeJob = {
        id: 'job-123',
        clientStatus: ClientJobStatus.READY,
        originalFilename: 'Q3_Planning_Meeting.mp3'
      };
      mockDb.getReadyToFetch.mockResolvedValue([fakeJob]);
      mockApi.getTranscript.mockResolvedValue(transcript);
      mockFileSystem.readFile.mockResolvedValue(transcript);

      await syncManager['fetchResults']();

      const finalPath = 'transcriptions/Q3_Planning_Meeting_transcription.txt';
      const temporaryPath = `${finalPath}.job-123.tmp`;
      expect(mockApi.getTranscript).toHaveBeenCalledWith('job-123');
      expect(mockFileSystem.writeFile).toHaveBeenCalledWith(temporaryPath, transcript);
      expect(mockFileSystem.readFile).toHaveBeenCalledWith(temporaryPath);
      expect(mockFileSystem.renameFile).toHaveBeenCalledWith(temporaryPath, finalPath);
      expect(mockFileSystem.deleteFile).not.toHaveBeenCalled();
      expect(mockFileSystem.writeFile.mock.invocationCallOrder[0])
        .toBeLessThan(mockFileSystem.readFile.mock.invocationCallOrder[0]);
      expect(mockFileSystem.readFile.mock.invocationCallOrder[0])
        .toBeLessThan(mockFileSystem.renameFile.mock.invocationCallOrder[0]);
      expect(mockDb.updateStatus).not.toHaveBeenCalled();
      expect(mockDb.markCompleted).not.toHaveBeenCalled();
      expect(mockNote.saveNote).not.toHaveBeenCalled();
    });

    it.each([
      {
        fault: 'write',
        reason: 'disk full'
      },
      {
        fault: 'read',
        reason: 'verification read failed'
      },
      {
        fault: 'mismatch',
        reason: 'Transcript verification mismatch'
      },
      {
        fault: 'rename',
        reason: 'rename blocked'
      }
    ])('preserves the final Transcript and cleans temporary data after a $fault fault', async ({
      fault,
      reason
    }) => {
      const transcript = 'Speaker 1: New Transcript';
      const finalPath = 'transcriptions/meeting_transcription.txt';
      const temporaryPath = `${finalPath}.job-123.tmp`;
      const sentinel = 'PRIOR FINAL TRANSCRIPT';
      const files = new Map([[finalPath, sentinel]]);
      const fakeJob = {
        id: 'job-123',
        clientStatus: ClientJobStatus.READY,
        originalFilename: 'meeting.wav'
      };
      mockDb.getAll.mockResolvedValue([fakeJob]);
      mockDb.getReadyToFetch.mockResolvedValue([fakeJob]);
      mockApi.getTranscript.mockResolvedValue(transcript);
      mockFileSystem.writeFile.mockImplementation(async (path: string, content: string) => {
        files.set(path, content);
        if (fault === 'write') throw new Error(reason);
      });
      mockFileSystem.readFile.mockImplementation(async (path: string) => {
        if (fault === 'read') throw new Error(reason);
        if (fault === 'mismatch') return 'CORRUPTED TRANSCRIPT';
        return files.get(path);
      });
      mockFileSystem.renameFile.mockImplementation(async (source: string, destination: string) => {
        if (fault === 'rename') throw new Error(reason);
        files.set(destination, files.get(source));
        files.delete(source);
      });
      mockFileSystem.deleteFile.mockImplementation(async (path: string) => {
        files.delete(path);
      });
      const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await syncManager.runFullSyncCycle();

      expect(files.get(finalPath)).toBe(sentinel);
      expect(files.has(temporaryPath)).toBe(false);
      expect(mockFileSystem.deleteFile).toHaveBeenCalledWith(temporaryPath);
      expect(stderr).toHaveBeenCalledWith(
        `Transcript download failed for job-123; retry on next Manual Sync: ${reason}`
      );
      expect(fakeJob.clientStatus).toBe(ClientJobStatus.READY);
      expect(mockApi.uploadMeeting).not.toHaveBeenCalled();
      expect(mockDb.updateStatus).not.toHaveBeenCalled();
      expect(mockDb.markCompleted).not.toHaveBeenCalled();
      expect(mockNote.saveNote).not.toHaveBeenCalled();
      stderr.mockRestore();
    });
  });
});
