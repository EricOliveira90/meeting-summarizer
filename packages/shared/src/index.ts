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

// UPLOAD OPTIONS

export enum TranscriptionLanguage {
  AUTO = 'auto',
  ENGLISH = 'en',
  PORTUGUESE = 'pt',
  SPANISH = 'es'
}

export enum SummaryTemplate {
  MEETING = 'meeting',   // Standard minutes, action items
  TRAINING = 'training', // Educational summary, key concepts, Q&A
  SUMMARY = 'summary'    // Brief overview, TL;DR
}

export interface UploadOptions {
  language: TranscriptionLanguage;
  template: SummaryTemplate;
  minSpeakers?: number;
  maxSpeakers?: number;
}