import Queue from 'better-queue';
import { JobStep, StepTimestamp } from '@meeting-summarizer/shared';
import type { ArtifactStore, JobQueue, JobStore } from '../domain/ports';
import type { JobRecord } from '../domain/models';
import type { AudioExtractionService } from './audio-extractor';
import type { TranscriptionService } from './transcriber';

export interface QueueInput {
  jobId: string;
  filePath: string;
}

export interface ProcessingDependencies {
  jobStore: Pick<JobStore, 'getById' | 'replace'>;
  artifacts: Pick<
    ArtifactStore,
    'getAudioPath' | 'getTranscriptPath' | 'fileExists'
  >;
  audioExtractor: Pick<AudioExtractionService, 'convertToWav'>;
  transcriber: Pick<TranscriptionService, 'transcribe'>;
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

async function updateJob(
  dependencies: ProcessingDependencies,
  id: string,
  update: (job: JobRecord) => void,
): Promise<void> {
  const job = await dependencies.jobStore.getById(id);
  if (!job) return;

  update(job);
  await dependencies.jobStore.replace(job);
}

async function updateJobData(
  dependencies: ProcessingDependencies,
  id: string,
  data: Partial<JobRecord>,
) {
  await updateJob(dependencies, id, (job) => Object.assign(job, data));
}

async function startStep(
  dependencies: ProcessingDependencies,
  jobId: string,
  step: JobStep,
) {
  await updateJob(dependencies, jobId, (job) => {
    const steps = job.steps || {};
    steps[step] = { startedAt: new Date().toISOString() };
    job.currentStep = step;
    job.steps = steps;
  });
}

async function completeStep(
  dependencies: ProcessingDependencies,
  jobId: string,
  step: JobStep,
) {
  await updateJob(dependencies, jobId, (job) => {
    const steps = job.steps || {};
    if (steps[step]) {
      steps[step]!.completedAt = new Date().toISOString();
    }
    job.steps = steps;
  });
}

export async function processMeetingJob(
  input: QueueInput,
  dependencies: ProcessingDependencies,
): Promise<void> {
  const { jobId, filePath } = input;
  const jobRecord = await dependencies.jobStore.getById(jobId);
  if (!jobRecord) throw new Error(`Job ${jobId} not found`);

  const language = jobRecord.options?.language || 'auto';
  const minSpeakers = jobRecord.options?.minSpeakers;
  const maxSpeakers = jobRecord.options?.maxSpeakers;
  const audioPath = dependencies.artifacts.getAudioPath(
    jobId,
    jobRecord.originalFilename,
  );
  const transcriptPath = dependencies.artifacts.getTranscriptPath(jobId);

  try {
    await updateJobData(dependencies, jobId, { serverStatus: 'PROCESSING' });
    await startStep(dependencies, jobId, JobStep.EXTRACTING_AUDIO);

    await dependencies.audioExtractor.convertToWav(filePath, audioPath);
    await updateJobData(dependencies, jobId, { audioPath });
    await completeStep(dependencies, jobId, JobStep.EXTRACTING_AUDIO);

    await startStep(dependencies, jobId, JobStep.TRANSCRIBING);

    await dependencies.transcriber.transcribe(audioPath, transcriptPath, {
      language,
      minSpeakers,
      maxSpeakers,
    });
    if (!await dependencies.artifacts.fileExists(transcriptPath)) {
      throw new Error('Transcript output is missing.');
    }
    await updateJobData(dependencies, jobId, { transcriptPath });
    await completeStep(dependencies, jobId, JobStep.TRANSCRIBING);

    await updateJob(dependencies, jobId, (job) => {
      const completedAt = new Date().toISOString();
      job.steps = {
        ...job.steps,
        [JobStep.TRANSCRIPT_READY]: {
          startedAt: completedAt,
          completedAt,
        },
      };
      job.serverStatus = 'COMPLETED';
      job.currentStep = JobStep.TRANSCRIPT_READY;
      job.recoveryAttempts = 0;
    });
  } catch (error: any) {
    console.error(`❌ [Job ${jobId}] Failed:`, error.message);
    const failedJob = await dependencies.jobStore.getById(jobId);
    await updateJobData(dependencies, jobId, {
      serverStatus: 'FAILED',
      error: error.message,
      failedStep: failedJob?.currentStep,
    });
    throw error;
  }
}

export function createMeetingQueue(
  dependencies: ProcessingDependencies,
): JobQueue {
  const processMeeting = (
    input: QueueInput,
    callback: (error?: unknown, result?: unknown) => void,
  ) => {
    processMeetingJob(input, dependencies)
      .then(() => callback(undefined, { success: true }))
      .catch((error) => callback(error));
  };

  return new Queue<QueueInput, unknown>(processMeeting, {
    concurrent: 1,
    afterProcessDelay: 1000,
  });
}
