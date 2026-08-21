import ffmpeg from 'fluent-ffmpeg';
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
   * @param outputPath - Exact path where the processed audio should be saved
   * @returns Promise resolving to the path of the generated .wav file
   */
  public async convertToWav(inputPath: string, outputPath: string): Promise<AudioExtractionResult> {
    return new Promise((resolve, reject) => {
      // 1. Validation
      if (!fs.existsSync(inputPath)) {
        return reject(new Error(`Input file not found: ${inputPath}`));
      }

      // 2. Configure FFmpeg
      ffmpeg(inputPath)
        .noVideo()                // Strip video stream
        .audioCodec('pcm_s16le')  // 16-bit PCM (Standard for WAV)
        .audioChannels(1)         // Mono (Whisper processes mono)
        .audioFrequency(16000)    // 16kHz (Whisper's native sample rate)
        .format('wav')
        .output(outputPath)
        
        // 3. Event Handlers
        .on('start', (commandLine) => {
          console.log('FFmpeg audio extraction started.');
        })
        .on('error', (err) => {
          console.error(`❌ FFmpeg Error:`, err.message);
          reject(err);
        })
        .on('end', () => {
          console.log('Audio extraction completed.');
          
          // Optionally get metadata to confirm duration
          ffmpeg.ffprobe(outputPath, (err, metadata) => {
            if (err) {
              reject(new Error('Unable to verify FFmpeg audio output.'));
              return;
            }

            const audioStreams = metadata.streams.filter(
              (stream) => stream.codec_type === 'audio',
            );
            const audio = audioStreams[0];
            const isWhisperWav =
              metadata.format.format_name === 'wav' &&
              audioStreams.length === 1 &&
              audio?.codec_name === 'pcm_s16le' &&
              Number(audio.sample_rate) === 16000 &&
              audio.channels === 1;

            if (!isWhisperWav) {
              reject(new Error(
                'FFmpeg output is not a 16-kHz mono signed 16-bit PCM WAV.',
              ));
              return;
            }

            resolve({
              audioPath: outputPath,
              duration: metadata.format.duration,
            });
          });
        })
        .run();
    });
  }
}

// Singleton instance for easy import
export const audioExtractionService = new AudioExtractionService();
