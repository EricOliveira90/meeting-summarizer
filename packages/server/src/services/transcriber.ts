import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface TranscriptionResult {
  outputFilePath: string;
}

export interface TranscribeOptions {
  language?: string;
  model?: string;
  batchSize?: number;
  minSpeakers?: number;
  maxSpeakers?: number;
}

export interface TranscriptionServiceOptions {
  executablePath?: string;
  scriptPath?: string;
  environment?: NodeJS.ProcessEnv;
}

const WHISPER_MODEL = 'base';
const BATCH_SIZE = 16;

export class TranscriptionService {
  private readonly executablePath: string;
  private readonly scriptPath: string;
  private readonly environment: NodeJS.ProcessEnv;

  constructor(options: TranscriptionServiceOptions = {}) {
    this.executablePath = options.executablePath ??
      path.join(process.cwd(), 'venv-whisperx', 'Scripts', 'python.exe');
    this.scriptPath = options.scriptPath ??
      path.join(process.cwd(), 'scripts', 'whisper-x.py');
    this.environment = options.environment ?? process.env;
  }

  public async transcribe(
    audioPath: string,
    outputTxtPath: string,
    options: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    if (!fs.existsSync(this.executablePath)) {
      throw new Error('Whisper executable was not found.');
    }

    const args = [
      this.scriptPath,
      audioPath,
      '--model', options.model || WHISPER_MODEL,
      '--batch_size', (options.batchSize ?? BATCH_SIZE).toString(),
      '--output_file', outputTxtPath,
    ];

    if (options.language && options.language !== 'auto') {
      args.push('--language', options.language);
    }
    if (options.minSpeakers !== undefined) {
      args.push('--min_speakers', options.minSpeakers.toString());
    }
    if (options.maxSpeakers !== undefined) {
      args.push('--max_speakers', options.maxSpeakers.toString());
    }

    console.log(`Spawning WhisperX for ${path.basename(audioPath)}.`);

    return new Promise((resolve, reject) => {
      const child = spawn(this.executablePath, args, {
        env: { ...this.environment },
        stdio: 'ignore',
        windowsHide: true,
      });

      child.once('error', () => {
        reject(new Error('Unable to start transcription.'));
      });
      child.once('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Transcription failed (code ${code ?? 'unknown'}).`));
          return;
        }
        if (!fs.existsSync(outputTxtPath)) {
          reject(new Error('Transcription output is missing.'));
          return;
        }

        console.log('Transcription completed.');
        resolve({ outputFilePath: outputTxtPath });
      });
    });
  }
}

export const transcriptionService = new TranscriptionService();
