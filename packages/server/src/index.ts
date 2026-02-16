import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { 
  JobRecord,
  Job,
  TranscriptionLanguage, 
  AIPromptTemplate,
  UploadResponse,
  ErrorResponse
} from '@meeting-summarizer/shared';
import { meetingQueue, getDb } from './services';
import { parseEnum } from './utils/helper';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const API_KEY = process.env.API_KEY;

// Export the build function
export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: 1048576 * 500, // 500MB
  });

  server.register(cors, { origin: '*' });
  server.register(multipart);

  // --- AUTHENTICATION ---
  server.addHook('onRequest', async (request, reply) => {
    if (API_KEY) {
      const clientKey = request.headers['x-api-key'];
      if (!clientKey || clientKey !== API_KEY) {
        console.warn(`🔒 Unauthorized access attempt from ${request.ip}`);
        return reply.code(401).send({ error: 'Unauthorized: Invalid or missing API Key' });
      }
    }
  });

  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  server.get('/', async () => ({ status: 'online', service: 'Meeting Summarizer Server' }));
    
  /**
   * ROUTE: POST /upload
   */
  server.post<{ Reply: UploadResponse | ErrorResponse }>('/upload', async (req, reply) => {
    const parts = req.parts();
    
    let uploadFilename = '';
    let savePath = '';
    const fields: Partial<Record<keyof JobRecord, any>> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        const fileId = randomUUID();
        uploadFilename = part.filename;
        const safeFilename = `${fileId}_${part.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        savePath = path.join(UPLOAD_DIR, safeFilename);

        await new Promise<void>((resolve, reject) => {
          const pump = fs.createWriteStream(savePath);
          part.file.pipe(pump);
          pump.on('finish', resolve);
          pump.on('error', reject);
        });
        
        fields.id = fileId;
      } else {
        fields[part.fieldname as keyof JobRecord] = part.value;
      }
    }

    if (!savePath) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    const minSpeakers = fields.minSpeakers ? parseInt(fields.minSpeakers) : undefined;
    const maxSpeakers = fields.maxSpeakers ? parseInt(fields.maxSpeakers) : undefined;

    const newJob: JobRecord = {
      id: fields.id,
      originalFilename: uploadFilename,
      filePath: savePath,
      uploadDate: new Date().toISOString(),
      status: 'PENDING',
      language: parseEnum(fields.language, TranscriptionLanguage, TranscriptionLanguage.AUTO),
      template: parseEnum(fields.template, AIPromptTemplate, AIPromptTemplate.MEETING),
      minSpeakers: isNaN(minSpeakers!) ? undefined : minSpeakers,
      maxSpeakers: isNaN(maxSpeakers!) ? undefined : maxSpeakers
    };

    const db = await getDb();
    db.data.jobs.push(newJob);
    await db.write();

    meetingQueue.push({ jobId: newJob.id, filePath: savePath });

    console.log(`📥 Upload: ${uploadFilename} | [${newJob.language}, ${newJob.template}]`);

    return { success: true, jobId: newJob.id, message: 'File queued.' };
  });

  /**
   * ROUTE: GET /jobs/:id
   * Returns: Job (Hydrated with text content)
   */
  server.get<{ Params: { id: string }, Reply: Job | ErrorResponse }>('/jobs/:id', async (req, reply) => {
    const db = await getDb();
    const job = db.data.jobs.find(j => j.id === req.params.id);

    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // Transform JobRecord -> Job
    // 1. Remove internal paths
    const { filePath, audioPath, transcriptPath, summaryPath, ...safeJob } = job;
    
    const responsePayload: Job = { ...safeJob };

    // 2. Hydrate Text Content
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      try {
        responsePayload.transcriptText = await fs.promises.readFile(transcriptPath, 'utf-8');
      } catch (err) {
        responsePayload.transcriptError = "File unreadable.";
      }
    }

    if (summaryPath && fs.existsSync(summaryPath)) {
      try {
        responsePayload.summaryText = await fs.promises.readFile(summaryPath, 'utf-8');
      } catch (err) {
        responsePayload.summaryError = "File unreadable.";
      }
    }

    return responsePayload;
  });

  return server;
}

// Only start listening if this file is run directly (not imported by tests)
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000');
  const HOST = '127.0.0.1';
  
  const app = buildServer();
  
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  app.listen({ port: PORT, host: HOST }, (err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    console.log(`\n🚀 Server listening at http://${HOST}:${PORT}`);
  });
}
