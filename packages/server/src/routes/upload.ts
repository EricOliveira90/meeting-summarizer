import { FastifyInstance } from 'fastify';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import {
  TranscriptionLanguage,
  AIPromptTemplate,
  UploadResponse,
  ErrorResponse
} from '@meeting-summarizer/shared';
import { getDb, meetingQueue, FileManagerService } from '../services';
import { JobRecord } from '../domain/models';

export async function uploadRoutes(server: FastifyInstance) {
  const fileManager = server.fileManager;

  server.post<{ Reply: UploadResponse | ErrorResponse }>('/upload', async (req, reply) => {
    const jobId = req.headers['x-job-id'] as string;
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
    const savePath = fileManager.getUploadPath(jobId, safeOriginalName);

    try {
      await pipeline(data.file, fs.createWriteStream(savePath));
    } catch (err) {
      try { await fs.promises.unlink(savePath); } catch {}
      return reply.status(500).send({ error: 'Stream processing failed' });
    }

    const db = await getDb();

    const newJob: JobRecord = {
      id: jobId,
      originalFilename: data.filename,
      filePath: savePath,
      recordedAt: new Date().toISOString(),
      serverStatus: 'PENDING',
      options: { language, template, minSpeakers, maxSpeakers }
    };

    const existingIndex = db.data.jobs.findIndex((j: JobRecord) => j.id === jobId);
    if (existingIndex !== -1) {
      db.data.jobs[existingIndex] = { ...db.data.jobs[existingIndex], ...newJob };
    } else {
      db.data.jobs.push(newJob);
    }
    await db.write();

    meetingQueue.push({ jobId, filePath: savePath });

    return { success: true, jobId, message: 'File queued.' };
  });
}
