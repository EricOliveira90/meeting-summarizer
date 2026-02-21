import axios, { AxiosInstance, AxiosError } from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { configService } from './config';
import { 
  UploadOptions,
  Job,
  UploadResponse,
  ErrorResponse
} from '@meeting-summarizer/shared'; 

class ApiService {
  private get client(): AxiosInstance {
    const { ip, port, apiKey } = configService.get('server');
    const baseURL = `http://${ip}:${port}`;
    
    return axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'x-api-key': apiKey
      },
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

  public async uploadMeeting(filePath: string, options: UploadOptions): Promise<UploadResponse> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const { apiKey } = configService.get('server');
    const form = new FormData();
    
    form.append('file', fs.createReadStream(filePath));

    try {
      console.log(`🚀 Uploading to server [Lang: ${options.language} | Tmpl: ${options.template}]...`);
      
      // Strict typing on the return: <UploadResponse>
      const response = await this.client.post<UploadResponse>('/upload', form, {
        headers: {
          ...form.getHeaders(),
          'x-job-id': options.jobId,
          'x-language': options.language,
          'x-template': options.template,
          'x-min-speakers': options.minSpeakers?.toString() || '',
          'x-max-speakers': options.maxSpeakers?.toString() || '',
          'x-api-key': apiKey
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 0,
      });

      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  public async getJobStatus(jobId: string): Promise<Job> {
    try {
      const response = await this.client.get<Job>(`/jobs/${jobId}`);
      return response.data;
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  public async getJobs(): Promise<Job[]> {
    try {
      const response = await this.client.get<Job[]>('/jobs');
      return response.data;
    } catch (error) {
      console.warn('⚠️ Could not fetch job history (Server might be offline)');
      return [];
    }
  }

  private handleError(error: unknown) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<ErrorResponse>;
      const msg = axiosError.response?.data?.error || axiosError.message;
      console.error(`❌ API Error: ${msg}`);
      
      if (axiosError.response?.status === 401) {
        console.error('🔒 Authentication Failed: Please check your API Key in settings.');
      }
    } else if (error instanceof Error) {
       console.error(`❌ Client Error: ${error.message}`);
    } else {
      console.error('❌ Unknown API Error');
    }
  }
}

export const apiService = new ApiService();
