import Queue from 'better-queue';
import path from 'path';
import fs from 'fs';
import { audioExtractionService } from './audio-extractor';
import { getDb, JobRecord } from './db';
import { transcriptionService } from './transcriber';
import { summaryService } from './summarizer';

interface QueueInput {
  jobId: string;
  filePath: string;
}

const processMeeting = async (input: QueueInput, cb: (err?: any, result?: any) => void) => {
  const { jobId, filePath } = input;
  const db = await getDb();
  
  const jobRecord = db.data.jobs.find(j => j.id === jobId);
  
  const language = jobRecord?.language || 'auto';
  const template = jobRecord?.template || 'meeting';

  try {
    console.log(`\n⚙️  [Job ${jobId}] Processing started...`);

    // --- STEP 1: EXTRACT AUDIO ---
    await updateJobStatus(jobId, 'EXTRACTING');
    
    const audioOutputDir = path.join(process.cwd(), 'audio_cache'); 
    // Ensure audio cache exists just in case
    if (!fs.existsSync(audioOutputDir)) fs.mkdirSync(audioOutputDir, { recursive: true });

    const extractionResult = await audioExtractionService.convertToWav(filePath, audioOutputDir);
    
    await updateJobData(jobId, { audioPath: extractionResult.audioPath });

    // CLEANUP: Delete the original upload (MKV) now that we have the WAV
    try {
      await fs.promises.unlink(filePath);
      console.log(`🗑️  Deleted original source file: ${path.basename(filePath)}`);
    } catch (err) {
      console.warn(`⚠️  Could not delete source file: ${filePath}`, err);
    }

    // --- STEP 2: TRANSCRIBE ---
    await updateJobStatus(jobId, 'TRANSCRIBING');
    
    // The service now saves to 'packages/server/transcriptions' automatically
    const transResult = await transcriptionService.transcribe(extractionResult.audioPath, language);

    // Save the PATH to the DB
    await updateJobData(jobId, { transcriptPath: transResult.outputFilePath });

    // --- STEP 3: SUMMARIZE ---
    await updateJobStatus(jobId, 'SUMMARIZING');
    
    // Pass the raw text + jobId (for filename) + template
    const sumResult = await summaryService.summarize(transResult.text, jobId, template);
    
    // Save the PATH to the DB
    await updateJobData(jobId, { summaryPath: sumResult.summaryPath });

    // --- STEP 4: COMPLETE ---
    await updateJobStatus(jobId, 'COMPLETED');
    
    cb(null, { 
      success: true, 
      audio: extractionResult.audioPath,
      transcriptPath: transResult.outputFilePath,
      summaryPath: sumResult.summaryPath
    });

  } catch (error: any) {
    console.error(`❌ [Job ${jobId}] Failed:`, error.message);
    await updateJobData(jobId, { status: 'FAILED', error: error.message });
    cb(error);
  }
};

export const meetingQueue = new Queue<QueueInput, any>(processMeeting, {
  concurrent: 1, 
  afterProcessDelay: 1000, 
});

// --- Helpers ---

async function updateJobStatus(id: string, status: JobRecord['status']) {
  const db = await getDb();
  const job = db.data.jobs.find(j => j.id === id);
  if (job) {
    job.status = status;
    await db.write();
  }
}

async function updateJobData(id: string, data: Partial<JobRecord>) {
  const db = await getDb();
  const index = db.data.jobs.findIndex(j => j.id === id);
  if (index !== -1) {
    db.data.jobs[index] = { ...db.data.jobs[index], ...data };
    await db.write();
  }
}