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
      template: AIPromptTemplate.MEETING
    };

    beforeEach(() => {
      // Mock file system to pretend the .mkv exists
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.createReadStream).mockReturnValue('mock-stream' as any);
    });

    it('successfully uploads and returns the response', async () => {
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { success: true, id: 'job-123', message: 'Uploaded' }
      });

      const response = await api.uploadMeeting('fake-path.mkv', id, mockOptions);

      expect(response.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);

      // Verify our headers were passed to Axios correctly
      const postArgs = mockAxiosInstance.post.mock.calls[0];
      expect(postArgs[0]).toBe('/upload');
      expect(postArgs[2].headers['x-job-id']).toBe('job-123');
      expect(postArgs[2].headers['x-api-key']).toBe('test-key');
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
      await api.uploadMeeting('fake-path.mkv', id, mockOptions, onProgress);

      expect(onProgress).toHaveBeenCalledWith(50); // 50/100 = 50%
    });

    it('throws a local Error if the file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(api.uploadMeeting('ghost-file.mkv', id, mockOptions))
        .rejects.toThrow('File not found: ghost-file.mkv');

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe('Error Formatting (SyncError)', () => {
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
