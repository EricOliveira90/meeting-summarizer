import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { getDb } from '../services/db'; // Ensure this points to your LowDB instance getter
import { meetingQueue } from '../services/queue'; // Ensure this points to your better-queue instance
import { TranscriptionLanguage, AIPromptTemplate } from '@meeting-summarizer/shared'; // Adjust path to your shared types
import { JobRecord } from '../domain/models';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

/**
 * Upload Route - Header-First Implementation
 * * Strategy:
 * 1. Metadata (ID, Language, Template) is extracted from HTTP Headers.
 * 2. File is streamed directly to its final destination (No temp files, no renaming).
 * 3. Database is updated idempotently.
 */
export async function uploadRoutes(server: FastifyInstance) {

  server.post('/upload', async (req, reply) => {
    // 1. HEADER VALIDATION (Metadata First)
    // We strictly require the Client to generate the UUID. This makes the Client the "Source of Truth".
    const jobId = req.headers['x-job-id'] as string;
    const language = (req.headers['x-language'] as TranscriptionLanguage) || TranscriptionLanguage.AUTO;
    const template = (req.headers['x-template'] as AIPromptTemplate) || AIPromptTemplate.MEETING;
    const minSpeakers = req.headers['x-min-speakers'] ? parseInt(req.headers['x-min-speakers'] as string) : undefined;
    const maxSpeakers = req.headers['x-max-speakers'] ? parseInt(req.headers['x-max-speakers'] as string) : undefined;

    if (!jobId) {
      return reply.status(400).send({ error: 'Missing required header: x-job-id' });
    }

    // 2. FILE HANDLING
    // consume the multipart data. We expect exactly one file field.
    const data = await req.file();

    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    // Sanitize filename to prevent directory traversal, but keep user's original name context
    const safeOriginalName = path.basename(data.filename).replace(/[^a-zA-Z0-9.-]/g, '_');
    // deterministic filename: {UUID}_{OriginalName}
    const finalFilename = `${jobId}_${safeOriginalName}`;
    const savePath = path.join(UPLOAD_DIR, finalFilename);

    console.log(`📥 Starting Stream: ${finalFilename} (ID: ${jobId})`);

    try {
      // 3. STREAM TO DISK
      // 'pipeline' manages the stream flow and handles errors/cleanup automatically
      await pipeline(
        data.file,
        fs.createWriteStream(savePath)
      );

      console.log(`✅ File Written: ${savePath}`);

    } catch (err) {
      console.error('❌ Upload Stream Failed:', err);
      // Clean up partial file if stream fails
      try { await fs.promises.unlink(savePath); } catch { }
      return reply.status(500).send({ error: 'Stream processing failed' });
    }

    // 4. DATABASE PERSISTENCE
    // We read the DB *after* the file is safe on disk.
    const db = await getDb();

    const newJob: JobRecord = {
      id: jobId,
      originalFilename: data.filename,
      filePath: savePath,
      recordedAt: new Date().toISOString(),
      serverStatus: 'PENDING', // Ready for processing
      options: {
        language,
        template,
        minSpeakers,
        maxSpeakers
      }
    };

    // Idempotency Check: If the Client retries the upload, we update the existing record
    const existingIndex = db.data.jobs.findIndex((j: JobRecord) => j.id === jobId);

    if (existingIndex !== -1) {
      console.log(`♻️  Updating existing job record: ${jobId}`);
      db.data.jobs[existingIndex] = { ...db.data.jobs[existingIndex], ...newJob };
    } else {
      db.data.jobs.push(newJob);
    }

    await db.write();

    // 5. TRIGGER PROCESSING QUEUE
    // Push to better-queue to start FFmpeg/Whisper
    meetingQueue.push({
      jobId: jobId,
      filePath: savePath
    });

    return reply.send({
      success: true,
      id: jobId,
      message: 'Upload successful. Processing started.'
    });
  });
}
