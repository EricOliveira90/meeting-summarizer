import { FastifyInstance } from 'fastify';
import {
  JobState,
  JobResponse,
  ErrorResponse
} from '@meeting-summarizer/shared';
import { JobStep } from '@meeting-summarizer/shared';
import { activeProcess, setActiveProcess } from '../services/queue';
import { JobRecord } from '../domain/models';

const PROHIBITED_RESPONSE_KEYS = new Set([
  'transcriptText',
  'summaryText',
  'filePath',
  'uploadPath',
  'audioPath',
  'transcriptPath',
  'summaryPath',
  'recoveryAttempts',
]);

function redactResponse(value: unknown, artifactRoot: string): unknown {
  if (typeof value === 'string') {
    return artifactRoot && value.includes(artifactRoot) ? undefined : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => redactResponse(item, artifactRoot))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (PROHIBITED_RESPONSE_KEYS.has(key)) continue;
      const redacted = redactResponse(item, artifactRoot);
      if (redacted !== undefined) result[key] = redacted;
    }
    return result;
  }

  return value;
}

export async function jobRoutes(server: FastifyInstance) {
  const artifacts = server.artifacts;
  const store = server.jobStore;

  /**
   * GET /jobs — Paginated, filterable job listing
   */
  server.get<{
    Querystring: { page?: string; limit?: string; status?: string }
  }>('/jobs', async (req, reply) => {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.max(1, parseInt(req.query.limit || '20'));
    const statusFilter = req.query.status as JobState | undefined;

    let jobs = await store.getAll();

    // Filter by status if provided
    if (statusFilter) {
      jobs = jobs.filter(j => j.serverStatus === statusFilter);
    }

    const total = jobs.length;
    const offset = (page - 1) * limit;
    const paged = jobs.slice(offset, offset + limit);

    const hydratedJobs = paged.map(toJobResponse);

    return { jobs: hydratedJobs, total, page, limit };
  });

  /**
   * GET /jobs/:id — Returns a single job hydrated with text content
   */
  server.get<{ Params: { id: string }, Reply: JobResponse | ErrorResponse }>('/jobs/:id', async (req, reply) => {
    const job = await store.getById(req.params.id);

    if (!job) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        error: 'Job was not found.',
      });
    }

    return toJobResponse(job);
  });

  server.get<{ Params: { id: string } }>('/jobs/:id/transcript', async (req, reply) => {
    const job = await store.getById(req.params.id);
    if (!job) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        error: 'Job was not found.',
      });
    }

    if (
      job.serverStatus !== 'COMPLETED' ||
      job.currentStep !== JobStep.TRANSCRIPT_READY ||
      !job.transcriptPath
    ) {
      return reply.status(409).send({
        code: 'TRANSCRIPT_NOT_READY',
        error: 'Transcript is not ready.',
      });
    }

    try {
      const transcript = await artifacts.readTranscript(job.transcriptPath);
      if (transcript !== null) {
        return reply.type('text/plain').send(transcript);
      }
    } catch {}

    return reply.status(409).send({
      code: 'TRANSCRIPT_NOT_READY',
      error: 'Transcript is not ready.',
    });
  });

  /**
   * DELETE /jobs/:id — Delete a job, cancel if processing, remove files
   */
  server.delete<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
    const job = await store.getById(req.params.id);
    if (!job) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        error: 'Job was not found.',
      });
    }

    // If processing, kill active subprocess
    if (job.serverStatus === 'PROCESSING' && activeProcess) {
      try {
        activeProcess.kill();
        setActiveProcess(null);
      } catch {}
    }

    // Delete associated files
    try {
      await artifacts.deleteJobFiles(job.id, job.originalFilename);
    } catch {}

    // Remove from DB
    await store.delete(job.id);

    return { success: true, message: 'Job deleted' };
  });

  /**
   * POST /jobs/:id/retry — Retry a failed job from the step that failed
   */
  server.post<{ Params: { id: string } }>('/jobs/:id/retry', async (req, reply) => {
    const job = await store.getById(req.params.id);

    if (!job) {
      return reply.status(404).send({
        code: 'JOB_NOT_FOUND',
        error: 'Job was not found.',
      });
    }

    if (job.serverStatus !== 'FAILED') {
      return reply.status(409).send({ error: 'Only FAILED jobs can be retried' });
    }

    // Reset status
    job.serverStatus = 'PENDING';
    job.error = undefined;
    job.failedStep = undefined;

    // Reset incomplete step timestamps, preserve completed ones
    if (job.steps) {
      for (const step of Object.values(JobStep)) {
        const stepData = job.steps[step];
        if (stepData && !stepData.completedAt) {
          // Incomplete step — clear it
          delete job.steps[step];
        }
      }
    }

    await store.replace(job);

    // Re-queue
    server.jobQueue.push({ jobId: job.id, filePath: job.filePath });

    return { success: true, message: 'Job re-queued' };
  });

  function toJobResponse(job: JobRecord): JobResponse {
    return redactResponse(job, artifacts.root) as JobResponse;
  }
}
