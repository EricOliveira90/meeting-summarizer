import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiService } from '../src/services/api';
import axios from 'axios';

// Mock Axios
vi.mock('axios');
const mockedAxios = axios as any;

describe('ApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checkHealth returns true when status is 200', async () => {
    // Setup Mock
    mockedAxios.create.mockReturnThis();
    mockedAxios.get.mockResolvedValue({ status: 200 });

    const isHealthy = await apiService.checkHealth();
    expect(isHealthy).toBe(true);
  });

  it('checkHealth returns false when server errors', async () => {
    mockedAxios.create.mockReturnThis();
    mockedAxios.get.mockRejectedValue(new Error('Network Error'));

    const isHealthy = await apiService.checkHealth();
    expect(isHealthy).toBe(false);
  });
});
