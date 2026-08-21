import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import fs from 'fs';
import { ApiService, configService } from '../../src/services';
import { SyncError } from '../../src/domain/';
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared';

// 1. Mock External Dependencies
vi.mock('axios');
vi.mock('fs');
vi.mock('../../src/services/config', () => ({
  configService: {
    get: vi.fn()
  }
}));

describe('ApiService', () => {
  let api: ApiService;
  let mockAxiosInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup baseline config mock
    vi.mocked(configService.get).mockImplementation((key: any): any => {
      if (key === 'server') return { ip: '127.0.0.1', port: 3000, apiKey: 'test-key' };
      return {};
    });

    // Setup Axios instance mock
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn()
    };
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance);
    vi.mocked(axios.isAxiosError).mockImplementation((payload) => true); // Default to true for error tests

    // Instantiate fresh class for each test
    api = new ApiService();
  });

  describe('checkHealth()', () => {
    it('returns isOnline: true and calculates latency on 200 OK', async () => {
      mockAxiosInstance.get.mockResolvedValueOnce({ status: 200 });

      const result = await api.checkHealth();

      expect(result.isOnline).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/');
    });

    it('returns isOnline: false when the server is unreachable', async () => {
      mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network Error'));

      const result = await api.checkHealth();

      expect(result.isOnline).toBe(false);
    });
  });

  describe('uploadMeeting()', () => {
    const id = 'job-123'
    const mockOptions = {
      language: TranscriptionLanguage.ENGLISH,
      template: AIPromptTemplate.MEETING,
      minSpeakers: 2,
      maxSpeakers: 5
    };

    beforeEach(() => {
      // Mock file system to pretend the .mkv exists
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.createReadStream).mockReturnValue('mock-stream' as any);
    });

    it('creates the persisted Job with canonical Recording metadata', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { success: true, jobId: 'job-123', message: 'Uploaded' }
      });

      const response = await api.uploadMeeting(
        'fake-path.mkv',
        id,
        '2026-08-20T09:30:00-03:00',
        mockOptions
      );

      expect(response).toEqual({
        success: true,
        jobId: 'job-123',
        message: 'Uploaded'
      });
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);

      const postArgs = mockAxiosInstance.post.mock.calls[0];
      expect(postArgs[0]).toBe('/jobs');
      expect(postArgs[2].headers).toMatchObject({
        'x-job-id': 'job-123',
        'x-recorded-at': '2026-08-20T12:30:00.000Z',
        'x-language': TranscriptionLanguage.ENGLISH,
        'x-template': AIPromptTemplate.MEETING,
        'x-min-speakers': '2',
        'x-max-speakers': '5',
        'x-api-key': 'test-key'
      });
    });

    it.each([
      {
        options: { ...mockOptions, minSpeakers: undefined },
        presentHeader: 'x-max-speakers',
        presentValue: '5',
        absentHeader: 'x-min-speakers'
      },
      {
        options: { ...mockOptions, maxSpeakers: undefined },
        presentHeader: 'x-min-speakers',
        presentValue: '2',
        absentHeader: 'x-max-speakers'
      }
    ])('omits only the undefined speaker bound', async ({
      options,
      presentHeader,
      presentValue,
      absentHeader
    }) => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { success: true, jobId: id, message: 'Uploaded' }
      });

      await api.uploadMeeting(
        'fake-path.mkv',
        id,
        '2026-08-20T09:30:00-03:00',
        options
      );

      const headers = mockAxiosInstance.post.mock.calls[0][2].headers;
      expect(headers[presentHeader]).toBe(presentValue);
      expect(headers).not.toHaveProperty(absentHeader);
    });

    it('triggers the onProgress callback during upload', async () => {
      // Simulate the onUploadProgress callback behavior inside Axios
      mockAxiosInstance.post.mockImplementationOnce(async (url: string, data: any, config: any) => {
        if (config.onUploadProgress) {
          config.onUploadProgress({ loaded: 50, total: 100 });
        }
        return { data: { success: true } };
      });

      const onProgress = vi.fn();
      await api.uploadMeeting(
        'fake-path.mkv',
        id,
        '2026-08-20T09:30:00-03:00',
        mockOptions,
        onProgress
      );

      expect(onProgress).toHaveBeenCalledWith(50); // 50/100 = 50%
    });

    it('throws a local Error if the file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(api.uploadMeeting(
        'ghost-file.mkv',
        id,
        '2026-08-20T09:30:00-03:00',
        mockOptions
      ))
        .rejects.toThrow('File not found: ghost-file.mkv');

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('Error Formatting (SyncError)', () => {
    it('preserves the exact JOB_NOT_FOUND response code', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            code: 'JOB_NOT_FOUND',
            error: 'Job was not found.'
          }
        }
      };
      mockAxiosInstance.get.mockRejectedValueOnce(axiosError);

      await expect(api.getJobStatus('job-123')).rejects.toMatchObject({
        message: 'Job was not found.',
        statusCode: 404,
        code: 'JOB_NOT_FOUND'
      });
    });

    it('formats ECONNREFUSED as a transient error (Tunnel Down)', async () => {
      const axiosError = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        message: 'Connection refused'
      };
      mockAxiosInstance.get.mockRejectedValueOnce(axiosError);

      try {
        await api.getJobs();
      } catch (error) {
        expect(error).toBeInstanceOf(SyncError);
        const syncErr = error as SyncError;
        expect(syncErr.isTransient).toBe(true); // SyncManager should retry!
      }
    });

    it('formats 401 Unauthorized as a FATAL error (Bad API Key)', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 401,
          data: { error: 'Invalid API Key' }
        }
      };
      mockAxiosInstance.get.mockRejectedValueOnce(axiosError);

      try {
        await api.getJobs();
      } catch (error) {
        expect(error).toBeInstanceOf(SyncError);
        const syncErr = error as SyncError;
        expect(syncErr.isTransient).toBe(false); // SyncManager should NOT retry, mark ABANDONED
        expect(syncErr.statusCode).toBe(401);
      }
    });
  });
});
