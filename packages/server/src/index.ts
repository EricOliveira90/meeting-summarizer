import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { meetingQueue } from './services/queue';
import { getDb, JobRecord } from './services/db';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = '0.0.0.0'; 

const server = Fastify({
  logger: false, 
  bodyLimit: 1048576 * 500, // 500MB
});

server.register(cors, { origin: '*' }); 
server.register(multipart);

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

server.get('/', async () => {
  return { status: 'online', service: 'Meeting Transcriber Server' };
});

/**
 * ROUTE: POST /upload
 * Handles Multipart Upload: File + Metadata Fields
 */
server.post('/upload', async (req, reply) => {
  const parts = req.parts();
  
  let uploadFilename = '';
  let savePath = '';
  const fields: Record<string, any> = {};

  // Iterate over all parts (fields and files)
  for await (const part of parts) {
    if (part.type === 'file') {
      const fileId = randomUUID();
      uploadFilename = part.filename;
      const safeFilename = `${fileId}_${part.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      savePath = path.join(UPLOAD_DIR, safeFilename);

      // Stream to disk
      await new Promise<void>((resolve, reject) => {
        const pump = fs.createWriteStream(savePath);
        part.file.pipe(pump);
        pump.on('finish', resolve);
        pump.on('error', reject);
      });
      
      // Store the ID for DB creation later
      fields.id = fileId;
    } else {
      // It's a field (language, minSpeakers, etc.)
      fields[part.fieldname] = part.value;
    }
  }

  if (!savePath) {
    return reply.status(400).send({ error: 'No file uploaded' });
  }

  // Parse Numbers safely
  const minSpeakers = fields.minSpeakers ? parseInt(fields.minSpeakers as string) : undefined;
  const maxSpeakers = fields.maxSpeakers ? parseInt(fields.maxSpeakers as string) : undefined;

  const newJob: JobRecord = {
    id: fields.id, // Generated during file processing
    originalFilename: uploadFilename,
    filePath: savePath,
    uploadDate: new Date().toISOString(),
    status: 'PENDING',
    language: fields.language as string || 'auto',
    template: fields.template as string || 'meeting',
    minSpeakers: isNaN(minSpeakers!) ? undefined : minSpeakers,
    maxSpeakers: isNaN(maxSpeakers!) ? undefined : maxSpeakers
  };

  const db = await getDb();
  db.data.jobs.push(newJob);
  await db.write();

  meetingQueue.push({ jobId: newJob.id, filePath: savePath });

  console.log(`📥 Upload: ${uploadFilename} | Speakers: ${newJob.minSpeakers || '?'}-${newJob.maxSpeakers || '?'}`);

  return { success: true, jobId: newJob.id, message: 'File queued.' };
});

server.get('/jobs', async () => {
  const db = await getDb();
  return db.data.jobs.sort((a, b) => 
    new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
  );
});

/**
 * ROUTE: GET /jobs/:id
 * HYDRATION: Reads transcript AND summary from disk on request.
 */
server.get<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
  const db = await getDb();
  const job = db.data.jobs.find(j => j.id === req.params.id);

  if (!job) return reply.status(404).send({ error: 'Job not found' });

  const responsePayload = { ...job } as any;

  // 1. Load Transcript
  if (job.transcriptPath && fs.existsSync(job.transcriptPath)) {
    try {
      responsePayload.transcript = await fs.promises.readFile(job.transcriptPath, 'utf-8');
    } catch (err) {
      responsePayload.transcriptError = "File not found.";
    }
  }

  // 2. Load Summary
  if (job.summaryPath && fs.existsSync(job.summaryPath)) {
    try {
      responsePayload.summary = await fs.promises.readFile(job.summaryPath, 'utf-8');
    } catch (err) {
      responsePayload.summaryError = "File not found.";
    }
  }

  return responsePayload;
});

const start = async () => {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 Server listening at http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();