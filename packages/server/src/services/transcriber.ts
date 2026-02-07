import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface TranscriptionResult {
  text: string;
  outputFilePath: string;
}

const TRANSCRIPTIONS_DIR = path.join(process.cwd(), 'transcriptions');
const WHISPER_MODEL = 'turbo';

// Ensure directory exists on startup
if (!fs.existsSync(TRANSCRIPTIONS_DIR)) {
  fs.mkdirSync(TRANSCRIPTIONS_DIR, { recursive: true });
}

export class TranscriptionService {
  private readonly venvPythonPath = path.join(process.cwd(), 'venv-whisperx', 'Scripts', 'python.exe');
  private readonly scriptPath = path.join(process.cwd(), 'scripts', 'whisper-x.py');
  private readonly hfToken = process.env.HUGGING_FACE_TOKEN; 

  public async transcribe(audioPath: string, language?: string): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      
      if (!fs.existsSync(this.venvPythonPath)) {
        return reject(new Error(`Virtual Environment Python not found at: ${this.venvPythonPath}`));
      }

      // 1. Prepare Output Path in the dedicated 'transcriptions' folder
      // We use the same basename as the audio file but change extension to .txt
      const parsedPath = path.parse(audioPath);
      const outputTxtPath = path.join(TRANSCRIPTIONS_DIR, `${parsedPath.name}.txt`);

      console.log(`🎙️  Spawning WhisperX on: ${parsedPath.base}`);
      console.log(`📂  Target Output: ${outputTxtPath}`);

      // 2. Build Arguments
      const args = [
        this.scriptPath,
        audioPath,
        '--model', WHISPER_MODEL,
        '--batch_size', '32',
        '--hf_token', this.hfToken || '', 
        '--output_file', outputTxtPath // Python will write directly here
      ];

      if (language && language !== 'auto') {
        args.push('--language', language);
      }

      // 3. Spawn Process
      const pythonProcess = spawn(this.venvPythonPath, args);

      let stdoutData = '';
      let stderrData = '';

      pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
      pythonProcess.stderr.on('data', (data) => { stderrData += data.toString(); });

      pythonProcess.on('close', async (code) => {
        if (code !== 0) {
          try {
             const errorJson = JSON.parse(stdoutData);
             if (errorJson.error) return reject(new Error(`WhisperX Error: ${errorJson.error}`));
          } catch (e) {}
          console.error(`❌ Process exited with code ${code}`);
          console.error(`   Stderr: ${stderrData}`);
          return reject(new Error(`Transcription failed with code ${code}`));
        }

        // 4. Success - Read the file back into memory for the return value
        try {
            if (!fs.existsSync(outputTxtPath)) {
                return reject(new Error(`Process success, but file missing: ${outputTxtPath}`));
            }
            const fileContent = await fs.promises.readFile(outputTxtPath, 'utf-8');
            console.log(`✅ Transcription saved.`);
            
            resolve({
              text: fileContent.trim(),
              outputFilePath: outputTxtPath
            });
        } catch (readError: any) {
            return reject(new Error(`Failed to read transcript: ${readError.message}`));
        }
      });
    });
  }
}

export const transcriptionService = new TranscriptionService();