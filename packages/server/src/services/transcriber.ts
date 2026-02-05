import { spawn } from 'child_process';
import path from 'path';

export interface TranscriptionResult {
  text: string;
  language: string;
  deviceUsed: string;
}

export class TranscriptionService {
  public async transcribe(audioPath: string): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      // 1. "process" here now correctly refers to the global Node.js object
      const scriptPath = path.join(process.cwd(), 'scripts', 'transcribe.py');

      console.log(`🎙️  Spawning Whisper process on: ${audioPath}`);

      // 2. RENAME: Changed 'process' to 'pythonProcess' to avoid naming conflict
      const pythonProcess = spawn('python', [scriptPath, audioPath]);

      let stdoutData = '';
      let stderrData = '';

      // 3. Update all references below to use the new name
      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`❌ Whisper process exited with code ${code}`);
          console.error(`   Stderr: ${stderrData}`);
          return reject(new Error(`Transcription failed: ${stderrData}`));
        }

        try {
          const result = JSON.parse(stdoutData);

          if (result.error) {
            return reject(new Error(result.error));
          }

          console.log(`✅ Transcription complete (${result.text.length} chars) using ${result.device_used}`);
          
          resolve({
            text: result.text,
            language: result.language,
            deviceUsed: result.device_used
          });

        } catch (err) {
          console.error('❌ Failed to parse Python output:', stdoutData);
          reject(new Error('Invalid JSON response from transcription script'));
        }
      });
    });
  }
}

export const transcriptionService = new TranscriptionService();