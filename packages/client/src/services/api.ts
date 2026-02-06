import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { configService } from './config';
import { UploadOptions } from '@shared'; 

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
    const { ip, port } = configService.get('server');
    const baseURL = `http://${ip}:${port}`;
    
    return axios.create({
      baseURL,
      timeout: 10000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const res = await this.client.get('/');
      return res.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Uploads the MKV file along with processing options.
   */
  public async uploadMeeting(filePath: string, options: UploadOptions): Promise<UploadResponse> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    
    // Append the new metadata fields
    form.append('language', options.language);
    form.append('template', options.template);

    try {
      console.log(`🚀 Uploading to server [Lang: ${options.language} | Tmpl: ${options.template}]...`);
      
      const response = await this.client.post<UploadResponse>('/upload', form, {
        headers: {
          ...form.getHeaders(),
        },
        timeout: 0, 
      });

      return response.data;
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  public async getJobStatus(jobId: string): Promise<JobStatus> {
    try {
      const response = await this.client.get<JobStatus>(`/jobs/${jobId}`);
      return response.data;
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  public async getJobs(): Promise<JobStatus[]> {
    try {
      const response = await this.client.get<JobStatus[]>('/jobs');
      return response.data;
    } catch (error: any) {
      console.warn('⚠️ Could not fetch job history (Server might be offline)');
      return [];
    }
  }

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