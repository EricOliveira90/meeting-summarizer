import axios, { AxiosInstance, AxiosError } from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import http from 'http';
import { configService } from './config';
import {
  UploadOptions,
  Job,
  UploadResponse,
  ErrorResponse
} from '@meeting-summarizer/shared';
import { HealthStatus, IApiService, SyncError } from '../domain';


export class ApiService implements IApiService {
  private _client: AxiosInstance | null = null;

  private get client(): AxiosInstance {
    if (!this._client) {
      const { ip, port, apiKey } = configService.get('server');
      const baseURL = `http://${ip}:${port}`;

      this._client = axios.create({
        baseURL,
        timeout: 10000,
        headers: { 'x-api-key': apiKey },
        // Keep-Alive is crucial for preventing SSH tunnel connection drops
        httpAgent: new http.Agent({ keepAlive: true }),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });
    }
    return this._client;
  }

  // Call this if the user updates their server IP or API key in the Setup menu
  public resetClient(): void {
    this._client = null;
  }

  public async checkHealth(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await this.client.get('/');
      return {
        isOnline: res.status === 200,
        latencyMs: Date.now() - start
      };
    } catch (error) {
      return { isOnline: false, latencyMs: 0 };
    }
  }

  public async uploadMeeting(
    filePath: string,
    id: string,
    options: UploadOptions,
    onProgress?: (percentCompleted: number) => void
  ): Promise<UploadResponse> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const { apiKey } = configService.get('server');
    const form = new FormData();

    form.append('file', fs.createReadStream(filePath));

    try {
      const response = await this.client.post<UploadResponse>('/upload', form, {
        headers: {
          ...form.getHeaders(),
          'x-job-id': id,
          'x-language': options.language,
          'x-template': options.template,
          'x-min-speakers': options.minSpeakers?.toString() || '',
          'x-max-speakers': options.maxSpeakers?.toString() || '',
          'x-api-key': apiKey
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 0, // Let the file take as long as it needs over the tunnel
        onUploadProgress: (progressEvent) => {
          if (onProgress && progressEvent.total) {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            onProgress(percentCompleted);
          }
        }
      });

      return response.data;
    } catch (error) {
      throw this.formatError(error);
    }
  }

  public async getJobStatus(jobId: string): Promise<Job> {
    try {
      const response = await this.client.get<Job>(`/jobs/${jobId}`);
      return response.data;
    } catch (error) {
      throw this.formatError(error);
    }
  }

  public async getJobs(): Promise<Job[]> {
    try {
      const response = await this.client.get<Job[]>('/jobs');
      return response.data;
    } catch (error) {
      throw this.formatError(error);
    }
  }

  // Translates raw Axios errors into our domain SyncError
  private formatError(error: unknown): SyncError | Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ErrorResponse>;
      const statusCode = axiosError.response?.status;
      const msg = axiosError.response?.data?.error || axiosError.message;

      // Determine if this is a transient network error (tunnel down) or fatal auth error
      const isTransient = !statusCode || statusCode >= 500 || ['ECONNREFUSED', 'ECONNRESET'].includes(axiosError.code || '');

      return new SyncError(msg, isTransient, statusCode);
    }

    if (error instanceof Error) return error;
    return new Error('Unknown API Error occurred');
  }
}
