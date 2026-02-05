import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';

// Interface for the extraction result
export interface AudioExtractionResult {
  audioPath: string;
  duration?: number; // Optional: helpful for logging processing speed later
}

export class AudioExtractionService {
  /**
   * Extracts audio from a video file and converts it to a Whisper-friendly format.
   * Specs: 16kHz, Mono, PCM 16-bit (wav).
   * * @param inputPath - Full path to the source video file (e.g., .mkv)
   * @param outputDir - Directory where the processed audio should be saved
   * @returns Promise resolving to the path of the generated .wav file
   */
  public async convertToWav(inputPath: string, outputDir: string): Promise<AudioExtractionResult> {
    return new Promise((resolve, reject) => {
      // 1. Validation
      if (!fs.existsSync(inputPath)) {
        return reject(new Error(`Input file not found: ${inputPath}`));
      }

      if (!fs.existsSync(outputDir)) {
        // Automatically create output directory if it doesn't exist
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // 2. Determine Output Path
      const filename = path.parse(inputPath).name;
      const outputPath = path.join(outputDir, `${filename}.wav`);

      console.log(`🎵 Starting audio extraction: ${filename}`);

      // 3. Configure FFmpeg
      ffmpeg(inputPath)
        .noVideo()                // Strip video stream
        .audioCodec('pcm_s16le')  // 16-bit PCM (Standard for WAV)
        .audioChannels(1)         // Mono (Whisper processes mono)
        .audioFrequency(16000)    // 16kHz (Whisper's native sample rate)
        .output(outputPath)
        
        // 4. Event Handlers
        .on('start', (commandLine) => {
          console.log(`   Spawned FFMpeg with command: ${commandLine}`);
        })
        .on('error', (err) => {
          console.error(`❌ FFmpeg Error:`, err.message);
          reject(err);
        })
        .on('end', () => {
          console.log(`✅ Audio extracted successfully: ${outputPath}`);
          
          // Optionally get metadata to confirm duration
          ffmpeg.ffprobe(outputPath, (err, metadata) => {
            if (err) {
              // Non-critical error, just resolve with path
              resolve({ audioPath: outputPath });
            } else {
              resolve({ 
                audioPath: outputPath, 
                duration: metadata.format.duration 
              });
            }
          });
        })
        .run();
    });
  }
}

// Singleton instance for easy import
export const audioExtractionService = new AudioExtractionService();