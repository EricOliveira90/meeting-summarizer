import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  TranscriptionLanguage,
  AIPromptTemplate,
  UploadResponse,
  ErrorResponse,
  JobStep,
} from '@meeting-summarizer/shared';
import { JobRecord } from '../domain/models';

export async function uploadRoutes(server: FastifyInstance) {
  const artifacts = server.artifacts;

  const createJob = async (req: FastifyRequest, reply: FastifyReply) => {
    const jobId = req.headers['x-job-id'] as string;
    const recordedAt = req.headers['x-recorded-at'] as string;
    const language = (req.headers['x-language'] as TranscriptionLanguage) || TranscriptionLanguage.AUTO;
    const template = (req.headers['x-template'] as AIPromptTemplate) || AIPromptTemplate.MEETING;
    const minSpeakers = req.headers['x-min-speakers'] ? parseInt(req.headers['x-min-speakers'] as string) : undefined;
    const maxSpeakers = req.headers['x-max-speakers'] ? parseInt(req.headers['x-max-speakers'] as string) : undefined;

    if (!jobId) {
      return reply.status(400).send({ error: 'Missing required header: x-job-id' });
    }

    const data = await req.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const safeOriginalName = data.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const savePath = artifacts.getUploadPath(jobId, safeOriginalName);
    let stagedPath: string | undefined;

    try {
      const staged = await artifacts.stageRecording(savePath, data.file);
      stagedPath = staged.stagedPath;
      await artifacts.commitRecording(staged.stagedPath, savePath);

      const options = {
        language,
        template,
        ...(minSpeakers === undefined ? {} : { minSpeakers }),
        ...(maxSpeakers === undefined ? {} : { maxSpeakers }),
      };
      const queuedAt = new Date().toISOString();
      const newJob: JobRecord = {
        id: jobId,
        originalFilename: data.filename,
        filePath: savePath,
        recordedAt: new Date(recordedAt).toISOString(),
        serverStatus: 'PENDING',
        currentStep: JobStep.QUEUED,
        steps: {
          [JobStep.QUEUED]: {
            startedAt: queuedAt,
            completedAt: queuedAt,
          },
        },
        options,
      };

      await server.jobStore.replace(newJob);
      server.jobQueue.push({ jobId, filePath: savePath });
    } catch {
      if (stagedPath) await artifacts.deleteRecording(stagedPath);
      await artifacts.deleteRecording(savePath);
      return reply.status(500).send({ error: 'Stream processing failed' });
    }

    return { success: true, jobId, message: 'File queued.' };
  };

  server.post<{ Reply: UploadResponse | ErrorResponse }>('/jobs', createJob);
  server.post<{ Reply: UploadResponse | ErrorResponse }>('/upload', createJob);
}
