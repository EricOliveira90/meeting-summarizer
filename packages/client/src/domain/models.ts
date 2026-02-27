import { Job } from "@meeting-summarizer/shared";

export enum NoteTemplate {
    STD_MEETING = 'Internal Meeting',   // Standard minutes, action items
    SELLER_MEETING = 'Seller Meeting',
    TRAINING = 'Training', // Educational summary, key concepts, Q&A
    SUMMARY = 'Simple Summary'    // Brief overview, TL;DR
}

export enum ClientJobStatus {
    WAITING_UPLOAD = 'WAITING_UPLOAD',
    UPLOADING = 'UPLOADING',
    PROCESSING = 'PROCESSING',
    READY = 'READY',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',                 // Intermittent error, will retry
    ABANDONED = 'ABANDONED',           // Max retries hit or fatal error
    DELETED = 'DELETED'                // User deleted the local file
}

export interface ClientJob extends Omit<Job, 'serverStatus'> {
    filePath: string;
    clientStatus: ClientJobStatus;
    retryCount: number;
    noteTemplate?: NoteTemplate
}

export class SyncError extends Error {
    constructor(
        public message: string,
        public isTransient: boolean, // true for ECONNREFUSED/ECONNRESET (Tunnel down), false for 401 (Bad Key)
        public statusCode?: number
    ) {
        super(message);
        this.name = 'SyncError';
    }
}

export interface HealthStatus {
    isOnline: boolean;
    latencyMs: number;
}
