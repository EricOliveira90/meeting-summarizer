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
  logger: true, 
  bodyLimit: 1048576 * 500, 
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

server.post('/upload', async (req, reply) => {
  const data = await req.file();
  if (!data) return reply.status(400).send({ error: 'No file uploaded' });

  const fileId = randomUUID();
  const safeFilename = `${fileId}_${data.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const savePath = path.join(UPLOAD_DIR, safeFilename);

  await new Promise<void>((resolve, reject) => {
    const pump = fs.createWriteStream(savePath);
    data.file.pipe(pump);
    pump.on('finish', resolve);
    pump.on('error', reject);
  });

  const newJob: JobRecord = {
    id: fileId,
    originalFilename: data.filename,
    filePath: savePath,
    uploadDate: new Date().toISOString(),
    status: 'PENDING'
  };

  const db = await getDb();
  db.data.jobs.push(newJob);
  await db.write();

  meetingQueue.push({ jobId: newJob.id, filePath: savePath });
  console.log(`📥 Upload received: ${data.filename} -> Job ${fileId}`);

  return { success: true, jobId: fileId, message: 'File queued.' };
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