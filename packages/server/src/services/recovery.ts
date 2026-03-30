import { JobStep } from '@meeting-summarizer/shared';
import { getDb } from './db';
import { JobRecord } from '../domain/models';

export interface FileCheckMethods {
  fileExists(path: string): Promise<boolean>;
  getAudioPath(jobId: string, filename: string): string;
  getTranscriptPath(jobId: string): string;
  getSummaryPath(jobId: string): string;
}

/**
 * Startup recovery: scan for PROCESSING jobs stuck from a previous crash.
 * 3-strike policy:
 *   recoveryAttempts === 0 → resume from last completed step
 *   recoveryAttempts === 1 → re-queue from scratch
 *   recoveryAttempts >= 2  → mark FAILED
 */
export async function recoverStalledJobs(
  queuePush: (input: { jobId: string; filePath: string }) => void,
  fileMethods: FileCheckMethods
): Promise<void> {
  const db = await getDb();
  const stalledJobs = db.data.jobs.filter(j => j.serverStatus === 'PROCESSING');

  for (const job of stalledJobs) {
    const attempts = job.recoveryAttempts || 0;

    if (attempts >= 2) {
      // Strike 3: mark as FAILED
      job.serverStatus = 'FAILED';
      job.error = 'Max recovery attempts exceeded';
      console.log(`❌ [Recovery] Job ${job.id}: max attempts exceeded, marking FAILED`);
    } else {
      // Strike 1 or 2: re-queue
      job.recoveryAttempts = attempts + 1;
      job.serverStatus = 'PENDING';

      if (attempts === 0) {
        // Resume from last completed step — detect via existing files
        console.log(`♻️ [Recovery] Job ${job.id}: resuming from last completed step (attempt ${job.recoveryAttempts})`);
      } else {
        // Re-queue from scratch
        console.log(`♻️ [Recovery] Job ${job.id}: re-queuing from scratch (attempt ${job.recoveryAttempts})`);
      }

      queuePush({ jobId: job.id, filePath: job.filePath });
    }
  }

  if (stalledJobs.length > 0) {
    await db.write();
  }
}

/**
 * Sets up graceful shutdown handlers.
 * On SIGINT/SIGTERM: pause queue, wait for current job, then close server.
 */
export function setupGracefulShutdown(
  server: { close: () => Promise<void> },
  queue: { pause: () => void; resume: () => void; destroy: (cb: () => void) => void }
): void {
  const shutdown = async (signal: string) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);

    // Pause queue — stop picking new jobs
    queue.pause();

    // Wait a moment for current job to finish, then destroy
    queue.destroy(() => {
      server.close().then(() => {
        console.log('✅ Server closed. Goodbye.');
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
