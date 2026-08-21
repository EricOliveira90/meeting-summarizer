import Queue from 'better-queue';
import { JobStep, StepTimestamp } from '@meeting-summarizer/shared';
import {
  audioExtractionService,
  getDb,
  transcriptionService
} from '.';
import { JobRecord } from '../domain/models';

export interface QueueInput {
  jobId: string;
  filePath: string;
}

/** Active child process reference (concurrency=1, so module-level is fine) */
export let activeProcess: any = null;

export function setActiveProcess(proc: any) {
  activeProcess = proc;
}

export function createInitialSteps(): Partial<Record<JobStep, StepTimestamp>> {
  const now = new Date().toISOString();
  return {
    [JobStep.QUEUED]: { startedAt: now, completedAt: now },
  };
}

async function updateJobData(id: string, data: Partial<JobRecord>) {
  const db = await getDb();
  const index = db.data.jobs.findIndex(j => j.id === id);
  if (index !== -1) {
    db.data.jobs[index] = { ...db.data.jobs[index], ...data };
    await db.write();
  }
}

async function startStep(jobId: string, step: JobStep) {
  const db = await getDb();
  const job = db.data.jobs.find(j => j.id === jobId);
  if (!job) return;

  const steps = job.steps || {};
  steps[step] = { startedAt: new Date().toISOString() };
  job.currentStep = step;
  job.steps = steps;
  await db.write();
}

async function completeStep(jobId: string, step: JobStep) {
  const db = await getDb();
  const job = db.data.jobs.find(j => j.id === jobId);
  if (!job) return;

  const steps = job.steps || {};
  if (steps[step]) {
    steps[step]!.completedAt = new Date().toISOString();
  }
  job.steps = steps;
  await db.write();
}

export async function processMeetingJob(input: QueueInput): Promise<void> {
  const { jobId, filePath } = input;
  const db = await getDb();
  const jobRecord = db.data.jobs.find(j => j.id === jobId);
  if (!jobRecord) throw new Error(`Job ${jobId} not found`);

  const language = jobRecord.options?.language || 'auto';
  const minSpeakers = jobRecord.options?.minSpeakers;
  const maxSpeakers = jobRecord.options?.maxSpeakers;

  try {
    // --- STEP 1: EXTRACT AUDIO ---
    await updateJobData(jobId, { serverStatus: 'PROCESSING' });
    await startStep(jobId, JobStep.EXTRACTING_AUDIO);

    const extractionResult = await audioExtractionService.convertToWav(filePath, '');
    await updateJobData(jobId, { audioPath: extractionResult.audioPath });
    await completeStep(jobId, JobStep.EXTRACTING_AUDIO);

    // --- STEP 2: TRANSCRIBE ---
    await startStep(jobId, JobStep.TRANSCRIBING);

    const transResult = await transcriptionService.transcribe(extractionResult.audioPath, {
      language,
      minSpeakers,
      maxSpeakers
    });
    await updateJobData(jobId, { transcriptPath: transResult.outputFilePath });
    await completeStep(jobId, JobStep.TRANSCRIBING);

    // --- STEP 3: TRANSCRIPT READY ---
    await startStep(jobId, JobStep.TRANSCRIPT_READY);
    await completeStep(jobId, JobStep.TRANSCRIPT_READY);
    await updateJobData(jobId, {
      serverStatus: 'COMPLETED',
      currentStep: JobStep.TRANSCRIPT_READY,
      recoveryAttempts: 0,
    });

  } catch (error: any) {
    console.error(`❌ [Job ${jobId}] Failed:`, error.message);
    const db2 = await getDb();
    const failedJob = db2.data.jobs.find(j => j.id === jobId);
    await updateJobData(jobId, {
      serverStatus: 'FAILED',
      error: error.message,
      failedStep: failedJob?.currentStep,
    });
    throw error;
  }
}

const processMeeting = (input: QueueInput, cb: (err?: any, result?: any) => void) => {
  processMeetingJob(input)
    .then(() => cb(null, { success: true }))
    .catch((err) => cb(err));
};

export const meetingQueue = new Queue<QueueInput, any>(processMeeting, {
  concurrent: 1,
  afterProcessDelay: 1000,
});
