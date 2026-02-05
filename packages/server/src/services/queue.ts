import Queue from 'better-queue';
import path from 'path';
import { audioExtractionService } from './audio-extractor';
import { getDb, JobRecord } from './db';
import { transcriptionService } from './transcriber';
import { summaryService } from './summarizer';

// Interface for the data passed into the Queue
interface QueueInput {
  jobId: string;
  filePath: string;
}

/**
 * The Worker Function
 * This runs inside the queue for each job.
 */
const processMeeting = async (input: QueueInput, cb: (err?: any, result?: any) => void) => {
  const { jobId, filePath } = input;
  const db = await getDb();
  
  try {
    console.log(`\n⚙️  [Job ${jobId}] Processing started...`);

    // --- STEP 1: UPDATE STATUS TO EXTRACTING ---
    await updateJobStatus(jobId, 'EXTRACTING');
    
    // Define output directory for audio (sister folder to uploads)
    // Assuming filePath is something like 'uploads/video.mkv'
    const audioOutputDir = path.join(path.dirname(filePath), '..', 'audio_cache');
    
    // --- STEP 2: EXTRACT AUDIO ---
    const extractionResult = await audioExtractionService.convertToWav(filePath, audioOutputDir);
    
    // Save the audio path to DB
    const jobIndex = db.data.jobs.findIndex(j => j.id === jobId);
    if (jobIndex >= 0) {
      db.data.jobs[jobIndex].audioPath = extractionResult.audioPath;
      await db.write();
    }

    // --- STEP 3: TRANSCRIBE ---
    await updateJobStatus(jobId, 'TRANSCRIBING');
    console.log(`   [Job ${jobId}] Audio ready at: ${extractionResult.audioPath}`);
    console.log(`   [Job ${jobId}] ⏳ Sending to Whisper (Python)...`);
    
    const transResult = await transcriptionService.transcribe(extractionResult.audioPath);

    // Save Transcript to DB
    const jobIndexTrans = db.data.jobs.findIndex(j => j.id === jobId);
    if (jobIndexTrans >= 0) {
      db.data.jobs[jobIndexTrans].transcript = transResult.text;
      await db.write();
    }

    // --- STEP 4: SUMMARIZE
    await updateJobStatus(jobId, 'SUMMARIZING');
    console.log(`   [Job ${jobId}] 🧠 Generating Summary with Gemini...`);

    const summary = await summaryService.summarize(transResult.text);
    
    // Save Summary to DB
    const jobIndexSum = db.data.jobs.findIndex(j => j.id === jobId);
    if (jobIndexSum >= 0) {
      db.data.jobs[jobIndexSum].summary = summary;
      await db.write();
    }

    // --- STEP 5: COMPLETE ---
    await updateJobStatus(jobId, 'COMPLETED');
    
    cb(null, { 
      success: true, 
      audio: extractionResult.audioPath,
      transcriptLength: transResult.text.length,
      summaryLength: summary.length
    });

  } catch (error: any) {
    console.error(`❌ [Job ${jobId}] Failed:`, error.message);
    
    // Log error to DB
    const jobIndex = db.data.jobs.findIndex(j => j.id === jobId);
    if (jobIndex >= 0) {
      db.data.jobs[jobIndex].status = 'FAILED';
      db.data.jobs[jobIndex].error = error.message;
      await db.write();
    }
    
    cb(error);
  }
};

/**
 * Queue Configuration
 */
export const meetingQueue = new Queue<QueueInput, any>(processMeeting, {
  concurrent: 1, // Process one meeting at a time to save CPU/RAM for Whisper
  afterProcessDelay: 1000, // Cool down between jobs
});

// Queue Events for global logging
meetingQueue.on('task_finish', (taskId, result) => {
  console.log(`✅ [Job] Task finished successfully.`);
});

meetingQueue.on('task_failed', (taskId, err) => {
  console.error(`💥 [Job] Task failed globally: ${err}`);
});

/**
 * Helper to update DB status safely
 */
async function updateJobStatus(id: string, status: JobRecord['status']) {
  const db = await getDb();
  const job = db.data.jobs.find(j => j.id === id);
  if (job) {
    job.status = status;
    await db.write();
  }
}