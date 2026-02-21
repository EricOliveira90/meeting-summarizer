export interface MeetingMetadata {
  title: string;
  date: string; // ISO format
  originalFileName: string;
}

export type JobState = 'PENDING' | 'EXTRACTING' | 'TRANSCRIBING' | 'SUMMARIZING' | 'COMPLETED' | 'FAILED';

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

export interface UploadOptions {
  jobId: string;
  language: TranscriptionLanguage;
  template: AIPromptTemplate;
  minSpeakers?: number;
  maxSpeakers?: number;
}

// The raw record stored in the Database (paths, not content)
export interface JobRecord {
  id: string;
  status: JobState;
  originalFilename: string;
  filePath: string; // Path to source audio/video
  uploadDate: string;
  
  // Processing Options
  language: TranscriptionLanguage;
  template: AIPromptTemplate;
  minSpeakers?: number;
  maxSpeakers?: number;

  // Output Paths (Server-side only references)
  audioPath?: string;
  transcriptPath?: string;
  summaryPath?: string;
  error?: string;
}

// The Data Transfer Object sent to the Client (Content, not paths)
export interface Job extends Omit<JobRecord, 'filePath' | 'audioPath' | 'transcriptPath' | 'summaryPath'> {
  // We explicitly exclude server-side paths from the API response for security/cleanliness
  transcriptText?: string;
  summaryText?: string;
  transcriptError?: string;
  summaryError?: string;
}

// Standardized API Responses
export interface UploadResponse {
  success: boolean;
  jobId: string;
  message: string;
}

export interface ErrorResponse {
  error: string;
}
