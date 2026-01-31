export interface MeetingMetadata {
  title: string;
  date: string; // ISO format
  originalFileName: string;
}

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TranscriptionJob {
  id: string;
  status: JobStatus;
  metadata: MeetingMetadata;
  transcriptText?: string;
  summaryText?: string;
  createdAt: number;
}

export interface ClientConfig {
  serverUrl: string;
  obsWsPort: number;
  obsWsPassword?: string;
  outputFolder: string;
  obsidianFolder: string;
  micDeviceId?: string;
  desktopDeviceId?: string;
}