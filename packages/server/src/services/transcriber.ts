import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface TranscriptionResult {
  text: string;
  outputFilePath: string;
}

export interface TranscribeOptions {
  language?: string;
  minSpeakers?: number;
  maxSpeakers?: number;
}

const TRANSCRIPTIONS_DIR = path.join(process.cwd(), 'transcriptions');
const WHISPER_MODEL = 'base';
const BATCH_SIZE = '16';

if (!fs.existsSync(TRANSCRIPTIONS_DIR)) {
  fs.mkdirSync(TRANSCRIPTIONS_DIR, { recursive: true });
}

export class TranscriptionService {
  private readonly venvPythonPath = path.join(process.cwd(), 'venv-whisperx', 'Scripts', 'python.exe');
  private readonly scriptPath = path.join(process.cwd(), 'scripts', 'whisper-x.py');
  private readonly hfToken = process.env.HUGGING_FACE_TOKEN; 

  public async transcribe(audioPath: string, options: TranscribeOptions): Promise<TranscriptionResult> {
    return new Promise((resolve, reject) => {
      
      if (!fs.existsSync(this.venvPythonPath)) {
        return reject(new Error(`Virtual Environment Python not found`));
      }

      const parsedPath = path.parse(audioPath);
      const outputTxtPath = path.join(TRANSCRIPTIONS_DIR, `${parsedPath.name}.txt`);

      console.log(`🎙️  Spawning WhisperX: ${parsedPath.base}`);
      
      // Build Arguments
      const args = [
        this.scriptPath,
        audioPath,
        '--model', WHISPER_MODEL,
        '--batch_size', BATCH_SIZE,
        '--hf_token', this.hfToken || '', 
        '--output_file', outputTxtPath
      ];

      // Add Optional Flags
      if (options.language && options.language !== 'auto') {
        args.push('--language', options.language);
      }
      if (options.minSpeakers !== undefined) {
        args.push('--min_speakers', options.minSpeakers.toString());
      }
      if (options.maxSpeakers !== undefined) {
        args.push('--max_speakers', options.maxSpeakers.toString());
      }

      const pythonProcess = spawn(this.venvPythonPath, args);

      let stdoutData = '';
      let stderrData = '';

      pythonProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
      pythonProcess.stderr.on('data', (data) => { stderrData += data.toString(); });

      pythonProcess.on('close', async (code) => {
        if (code !== 0) {
           // Try parsing JSON error
           try {
             const errorJson = JSON.parse(stdoutData);
             if (errorJson.error) return reject(new Error(`WhisperX Error: ${errorJson.error}`));
           } catch(e) {}
           return reject(new Error(`Transcription failed (Code ${code}). Stderr: ${stderrData}`));
        }

        try {
            if (!fs.existsSync(outputTxtPath)) return reject(new Error(`Output file missing: ${outputTxtPath}`));
            
            const fileContent = await fs.promises.readFile(outputTxtPath, 'utf-8');
            console.log(`✅ Transcription saved.`);
            resolve({ text: fileContent.trim(), outputFilePath: outputTxtPath });
        } catch (readError: any) {
            reject(new Error(`Failed to read transcript: ${readError.message}`));
        }
      });
    });
  }
}

export const transcriptionService = new TranscriptionService();