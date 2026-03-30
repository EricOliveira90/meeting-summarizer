import { Job, JobStep, StepTimestamp } from "@meeting-summarizer/shared";

// Output Paths (Server-side only references)
export interface JobRecord extends Job {
    filePath: string;
    audioPath?: string;
    transcriptPath?: string;
    summaryPath?: string;
    steps?: Partial<Record<JobStep, StepTimestamp>>;
    recoveryAttempts?: number;
}
