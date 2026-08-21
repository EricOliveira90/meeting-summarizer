import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ffmpegMock = vi.hoisted(() => {
  const handlers: Record<string, (...args: any[]) => void> = {};
  const command = {
    noVideo: vi.fn(),
    audioCodec: vi.fn(),
    audioChannels: vi.fn(),
    audioFrequency: vi.fn(),
    format: vi.fn(),
    output: vi.fn(),
    on: vi.fn(),
    run: vi.fn(),
  };

  for (const method of [
    command.noVideo,
    command.audioCodec,
    command.audioChannels,
    command.audioFrequency,
    command.format,
    command.output,
    command.on,
  ]) {
    method.mockReturnValue(command);
  }
  command.on.mockImplementation((event: string, handler: (...args: any[]) => void) => {
    handlers[event] = handler;
    return command;
  });
  command.run.mockImplementation(() => handlers.end());

  const factory = vi.fn(() => command) as any;
  factory.ffprobe = vi.fn();

  return { command, factory, handlers };
});

vi.mock('fluent-ffmpeg', () => ({ default: ffmpegMock.factory }));

import { AudioExtractionService } from '../../src/services/audio-extractor';

describe('AudioExtractionService', () => {
  let tempDir: string;
  let inputPath: string;
  let outputPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(ffmpegMock.handlers)) {
      delete ffmpegMock.handlers[key];
    }
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-extractor-'));
    inputPath = path.join(tempDir, 'Recording source.bin');
    outputPath = path.join(tempDir, 'unrelated output', 'canonical.wav');
    fs.writeFileSync(inputPath, 'Recording');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects FFmpeg output unless the exact path contains one 16-kHz mono signed 16-bit PCM stream', async () => {
    ffmpegMock.factory.ffprobe.mockImplementation(
      (_path: string, callback: (error: Error | null, metadata: any) => void) => {
        callback(null, {
          format: { duration: 1 },
          streams: [{
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000',
            channels: 2,
          }],
        });
      },
    );

    const extraction = new AudioExtractionService();
    await expect(extraction.convertToWav(inputPath, outputPath)).rejects.toThrow(
      'FFmpeg output is not a 16-kHz mono signed 16-bit PCM WAV.',
    );

    expect(ffmpegMock.factory).toHaveBeenCalledWith(inputPath);
    expect(ffmpegMock.command.output).toHaveBeenCalledWith(outputPath);
    expect(ffmpegMock.command.audioCodec).toHaveBeenCalledWith('pcm_s16le');
    expect(ffmpegMock.command.audioChannels).toHaveBeenCalledWith(1);
    expect(ffmpegMock.command.audioFrequency).toHaveBeenCalledWith(16000);
    expect(ffmpegMock.factory.ffprobe).toHaveBeenCalledWith(
      outputPath,
      expect.any(Function),
    );
  });

  it('forces and verifies the WAV container before returning the audio path', async () => {
    ffmpegMock.factory.ffprobe.mockImplementation(
      (_path: string, callback: (error: Error | null, metadata: any) => void) => {
        callback(null, {
          format: { duration: 1, format_name: 'nut' },
          streams: [{
            codec_type: 'audio',
            codec_name: 'pcm_s16le',
            sample_rate: '16000',
            channels: 1,
          }],
        });
      },
    );

    const extraction = new AudioExtractionService();
    await expect(extraction.convertToWav(inputPath, outputPath)).rejects.toThrow(
      'FFmpeg output is not a 16-kHz mono signed 16-bit PCM WAV.',
    );

    expect(ffmpegMock.command.format).toHaveBeenCalledWith('wav');
  });
});
