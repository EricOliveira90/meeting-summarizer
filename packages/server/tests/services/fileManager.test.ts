import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { FileManagerService } from '../../src/services/file-manager';

describe('FileManagerService', () => {
  let baseDir: string;
  let fileManager: FileManagerService;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-test-'));
    fileManager = new FileManagerService(baseDir);
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  // --- Path Resolution ---

  it('returns deterministic upload path for a given jobId and filename', () => {
    const result = fileManager.getUploadPath('job-123', 'meeting.mkv');
    expect(result).toBe(path.join(baseDir, 'uploads', 'job-123_meeting.mkv'));
  });

  it('returns deterministic audio path for a given jobId and filename', () => {
    const result = fileManager.getAudioPath('job-123', 'meeting.mkv');
    expect(result).toBe(path.join(baseDir, 'audio_cache', 'job-123_meeting.wav'));
  });

  it('returns deterministic transcript path for a given jobId', () => {
    const result = fileManager.getTranscriptPath('job-123');
    expect(result).toBe(path.join(baseDir, 'transcriptions', 'job-123_transcript.txt'));
  });

  it('returns deterministic summary path for a given jobId', () => {
    const result = fileManager.getSummaryPath('job-123');
    expect(result).toBe(path.join(baseDir, 'summaries', 'job-123_summary.txt'));
  });

  // --- Directory Bootstrapping ---

  it('ensureDirectories creates all four directories', async () => {
    await fileManager.ensureDirectories();

    expect(fs.existsSync(path.join(baseDir, 'uploads'))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'audio_cache'))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'transcriptions'))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, 'summaries'))).toBe(true);
  });

  it('ensureDirectories is idempotent (no error if dirs already exist)', async () => {
    await fileManager.ensureDirectories();
    await fileManager.ensureDirectories(); // second call should not throw
  });

  // --- File Reading ---

  it('readTranscript returns file content when transcript exists', async () => {
    await fileManager.ensureDirectories();
    const transcriptPath = fileManager.getTranscriptPath('job-456');
    fs.writeFileSync(transcriptPath, 'Speaker 1: Hello world');

    const content = await fileManager.readTranscript('job-456');
    expect(content).toBe('Speaker 1: Hello world');
  });

  it('readTranscript returns null when transcript does not exist', async () => {
    const content = await fileManager.readTranscript('nonexistent');
    expect(content).toBeNull();
  });

  it('readSummary returns file content when summary exists', async () => {
    await fileManager.ensureDirectories();
    const summaryPath = fileManager.getSummaryPath('job-789');
    fs.writeFileSync(summaryPath, '## Meeting Summary\nKey decisions...');

    const content = await fileManager.readSummary('job-789');
    expect(content).toBe('## Meeting Summary\nKey decisions...');
  });

  it('readSummary returns null when summary does not exist', async () => {
    const content = await fileManager.readSummary('nonexistent');
    expect(content).toBeNull();
  });

  // --- File Existence Checks ---

  it('fileExists returns true when file exists on disk', async () => {
    await fileManager.ensureDirectories();
    const filePath = fileManager.getSummaryPath('job-abc');
    fs.writeFileSync(filePath, 'content');

    expect(await fileManager.fileExists(filePath)).toBe(true);
  });

  it('fileExists returns false when file does not exist', async () => {
    expect(await fileManager.fileExists('/nonexistent/path.txt')).toBe(false);
  });

  // --- File Deletion ---

  it('deleteJobFiles removes all files for a job that exist on disk', async () => {
    await fileManager.ensureDirectories();
    const uploadPath = fileManager.getUploadPath('job-del', 'test.mkv');
    const audioPath = fileManager.getAudioPath('job-del', 'test.mkv');
    const transcriptPath = fileManager.getTranscriptPath('job-del');
    const summaryPath = fileManager.getSummaryPath('job-del');

    // Create all files
    fs.writeFileSync(uploadPath, 'upload');
    fs.writeFileSync(audioPath, 'audio');
    fs.writeFileSync(transcriptPath, 'transcript');
    fs.writeFileSync(summaryPath, 'summary');

    await fileManager.deleteJobFiles('job-del', 'test.mkv');

    expect(fs.existsSync(uploadPath)).toBe(false);
    expect(fs.existsSync(audioPath)).toBe(false);
    expect(fs.existsSync(transcriptPath)).toBe(false);
    expect(fs.existsSync(summaryPath)).toBe(false);
  });

  it('deleteJobFiles removes a Recording stored with a sanitized artifact name', async () => {
    await fileManager.ensureDirectories();
    const uploadPath = fileManager.getUploadPath('job-123', 'team_retro_.wav');
    fs.writeFileSync(uploadPath, 'upload');

    await fileManager.deleteJobFiles('job-123', 'team retro?.wav');

    expect(fs.existsSync(uploadPath)).toBe(false);
  });

  it('deleteJobFiles does not throw when files do not exist', async () => {
    await fileManager.ensureDirectories();
    // Should not throw even if no files exist
    await fileManager.deleteJobFiles('nonexistent-job', 'nofile.mkv');
  });
});
