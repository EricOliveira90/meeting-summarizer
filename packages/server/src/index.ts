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
const HOST = '0.0.0.0'; // Listen on all interfaces (LAN access)

// Initialize Fastify
const server = Fastify({
  logger: true, // Enable built-in logging
  bodyLimit: 1048576 * 500, // Limit uploads to 500MB (adjust as needed)
});

// Register Plugins
server.register(cors, { origin: '*' }); // Allow LAN connections
server.register(multipart);

// Ensure Upload Directory Exists
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * ROUTE: GET /
 * Health check to verify server is online
 */
server.get('/', async () => {
  return { status: 'online', service: 'Meeting Transcriber Server' };
});

/**
 * ROUTE: POST /upload
 * Handles the .mkv file upload from the Client CLI
 */
server.post('/upload', async (req, reply) => {
  const data = await req.file();

  if (!data) {
    return reply.status(400).send({ error: 'No file uploaded' });
  }

  const fileId = randomUUID();
  const safeFilename = `${fileId}_${data.filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const savePath = path.join(UPLOAD_DIR, safeFilename);

  // Stream file to disk
  await new Promise<void>((resolve, reject) => {
    const pump = fs.createWriteStream(savePath);
    data.file.pipe(pump);
    pump.on('finish', resolve);
    pump.on('error', reject);
  });

  // Create Job Record
  const newJob: JobRecord = {
    id: fileId,
    originalFilename: data.filename,
    filePath: savePath,
    uploadDate: new Date().toISOString(),
    status: 'PENDING'
  };

  // Save to DB
  const db = await getDb();
  db.data.jobs.push(newJob);
  await db.write();

  // Add to Processing Queue
  meetingQueue.push({ jobId: newJob.id, filePath: savePath });

  console.log(`📥 Upload received: ${data.filename} -> Job ${fileId}`);

  return { 
    success: true, 
    jobId: fileId, 
    message: 'File uploaded and queued for processing.' 
  };
});

/**
 * ROUTE: GET /jobs
 * Returns all jobs so the Client can poll for status updates
 */
server.get('/jobs', async () => {
  const db = await getDb();
  // Return jobs sorted by newest first
  return db.data.jobs.sort((a, b) => 
    new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
  );
});

/**
 * ROUTE: GET /jobs/:id
 * Get details for a specific job
 */
server.get<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
  const db = await getDb();
  const job = db.data.jobs.find(j => j.id === req.params.id);

  if (!job) {
    return reply.status(404).send({ error: 'Job not found' });
  }
  return job;
});

// Start the Server
const start = async () => {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 Server listening at http://${HOST}:${PORT}`);
    console.log(`📂 Uploads saving to: ${UPLOAD_DIR}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();