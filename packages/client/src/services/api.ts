import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { configService } from './config';

export interface JobStatus {
  id: string;
  status: 'PENDING' | 'EXTRACTING' | 'TRANSCRIBING' | 'SUMMARIZING' | 'COMPLETED' | 'FAILED';
  originalFilename: string;
  uploadDate: string;
  transcript?: string;
  summary?: string;
  error?: string;
}

export interface UploadResponse {
  success: boolean;
  jobId: string;
  message: string;
}

class ApiService {
  private get client(): AxiosInstance {
    // Dynamic config retrieval allows user to change IP without restart
    const { ip, port } = configService.get('server');
    const baseURL = `http://${ip}:${port}`;
    
    return axios.create({
      baseURL,
      timeout: 10000, // 10s timeout for standard requests
      maxContentLength: Infinity, // Allow large responses
      maxBodyLength: Infinity // Allow large uploads
    });
  }

  /**
   * Checks if the processing server is online.
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const res = await this.client.get('/');
      return res.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Uploads the MKV file to the server for processing.
   * Uses streams to handle large files efficiently.
   */
  public async uploadMeeting(filePath: string): Promise<UploadResponse> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const form = new FormData();
    // 'file' matches the field name expected in server/src/index.ts
    form.append('file', fs.createReadStream(filePath));

    try {
      console.log(`🚀 Uploading ${filePath} to server...`);
      
      const response = await this.client.post<UploadResponse>('/upload', form, {
        headers: {
          ...form.getHeaders(), // Critical: sets the Content-Type boundary
        },
        timeout: 0, // No timeout for uploads (large files take time)
      });

      return response.data;
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Fetches the current status of a specific job.
   */
  public async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      const response = await this.client.get<JobStatus>(`/jobs/${jobId}`);
      return response.data;
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  /**
   * Fetches all jobs (history).
   */
  public async getJobs(): Promise<JobStatus[]> {
    try {
      const response = await this.client.get<JobStatus[]>('/jobs');
      return response.data;
    } catch (error: any) {
      console.warn('⚠️ Could not fetch job history (Server might be offline)');
      return [];
    }
  }

  /**
   * Centralized error logging
   */
  private handleError(error: any) {
    if (axios.isAxiosError(error)) {
      const msg = error.response?.data?.error || error.message;
      console.error(`❌ API Error: ${msg}`);
    } else {
      console.error('❌ Unknown API Error:', error);
    }
  }
}

export const apiService = new ApiService();