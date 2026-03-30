import { FastifyInstance } from 'fastify';
import {
  Job,
  JobState,
  JobResponse,
  ErrorResponse
} from '@meeting-summarizer/shared';
import { JobStep, StepTimestamp } from '@meeting-summarizer/shared';
import { getDb, activeProcess, setActiveProcess, meetingQueue } from '../services';
import { JobRecord } from '../domain/models';

export async function jobRoutes(server: FastifyInstance) {
  const fileManager = server.fileManager;

  /**
   * GET /jobs — Paginated, filterable job listing
   */
  server.get<{
    Querystring: { page?: string; limit?: string; status?: string }
  }>('/jobs', async (req, reply) => {
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const limit = Math.max(1, parseInt(req.query.limit || '20'));
    const statusFilter = req.query.status as JobState | undefined;

    const db = await getDb();
    let jobs = db.data.jobs;

    // Filter by status if provided
    if (statusFilter) {
      jobs = jobs.filter(j => j.serverStatus === statusFilter);
    }

    const total = jobs.length;
    const offset = (page - 1) * limit;
    const paged = jobs.slice(offset, offset + limit);

    const hydratedJobs = await Promise.all(paged.map(j => hydrateJobResponse(j)));

    return { jobs: hydratedJobs, total, page, limit };
  });

  /**
   * GET /jobs/:id — Returns a single job hydrated with text content
   */
  server.get<{ Params: { id: string }, Reply: JobResponse | ErrorResponse }>('/jobs/:id', async (req, reply) => {
    const db = await getDb();
    const job = db.data.jobs.find(j => j.id === req.params.id);

    if (!job) return reply.status(404).send({ error: 'Job not found' });

    return hydrateJobResponse(job);
  });

  /**
   * DELETE /jobs/:id — Delete a job, cancel if processing, remove files
   */
  server.delete<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
    const db = await getDb();
    const jobIndex = db.data.jobs.findIndex(j => j.id === req.params.id);

    if (jobIndex === -1) return reply.status(404).send({ error: 'Job not found' });

    const job = db.data.jobs[jobIndex];

    // If processing, kill active subprocess
    if (job.serverStatus === 'PROCESSING' && activeProcess) {
      try {
        activeProcess.kill();
        setActiveProcess(null);
      } catch {}
    }

    // Delete associated files
    try {
      await fileManager.deleteJobFiles(job.id, job.originalFilename);
    } catch {}

    // Remove from DB
    db.data.jobs.splice(jobIndex, 1);
    await db.write();

    return { success: true, message: 'Job deleted' };
  });

  /**
   * POST /jobs/:id/retry — Retry a failed job from the step that failed
   */
  server.post<{ Params: { id: string } }>('/jobs/:id/retry', async (req, reply) => {
    const db = await getDb();
    const job = db.data.jobs.find(j => j.id === req.params.id);

    if (!job) return reply.status(404).send({ error: 'Job not found' });

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

    await db.write();

    // Re-queue
    meetingQueue.push({ jobId: job.id, filePath: job.filePath });

    return { success: true, message: 'Job re-queued' };
  });

  async function hydrateJobResponse(job: JobRecord): Promise<JobResponse> {
    const { filePath, audioPath, transcriptPath, summaryPath, recoveryAttempts, ...safeJob } = job;
    const response: JobResponse = { ...safeJob };

    const transcriptText = await fileManager.readTranscript(job.id);
    if (transcriptText !== null) {
      response.transcriptText = transcriptText;
    }

    const summaryText = await fileManager.readSummary(job.id);
    if (summaryText !== null) {
      response.summaryText = summaryText;
    }

    return response;
  }
}
