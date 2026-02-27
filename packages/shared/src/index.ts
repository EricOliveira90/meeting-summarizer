export type JobState = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export enum TranscriptionLanguage {
  AUTO = 'auto',
  ENGLISH = 'en',
  PORTUGUESE = 'pt',
  SPANISH = 'es'
}

export enum AIPromptTemplate {
  MEETING = 'meeting',   // Standard minutes, action items
  TRAINING = 'training', // Educational summary, key concepts, Q&A
  SUMMARY = 'summary'    // Brief overview, TL;DR
}

/**
 * API Contracts
 */
export interface UploadOptions {
  language: TranscriptionLanguage;
  template: AIPromptTemplate;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export interface UploadResponse {
  success: boolean;
  jobId: string;
  message: string;
}

export interface ErrorResponse {
  error: string;
}

export interface Job {
  id: string;
  originalFilename: string;
  serverStatus: JobState;
  recordedAt: string;
  options?: UploadOptions;
  error?: string;
}

export interface JobResponse extends Job {
  transcriptText?: string;
  summaryText?: string;
  transcriptError?: string;
  summaryError?: string;
}