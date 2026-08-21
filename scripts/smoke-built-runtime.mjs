import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FormData from 'form-data';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const require = createRequire(import.meta.url);

function runClientHelp() {
  const clientPath = path.join(repoRoot, 'packages/client/dist/index.js');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [clientPath, '--help'], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function smokeClient() {
  const result = await runClientHelp();

  assert.equal(result.code, 0, result.stderr);
  for (const command of ['start', 'record', 'sync', 'settings', 'audio']) {
    assert.match(
      result.stdout,
      new RegExp(`^\\s+${command}(?:\\s|$)`, 'm'),
      `Client help did not list the "${command}" command`,
    );
  }
}

function runServerWithoutApiKey(serverPath) {
  const env = { ...process.env };
  delete env.API_KEY;
  delete env.GEMINI_API_KEY;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd: repoRoot,
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function smokeServer() {
  const serverPath = path.join(repoRoot, 'packages/server/dist/index.js');
  const missingKey = await runServerWithoutApiKey(serverPath);
  assert.notEqual(missingKey.code, 0);
  assert.equal(missingKey.stdout, '');
  assert.deepEqual(
    missingKey.stderr.trim().split(/\r?\n/),
    ['CONFIG_API_KEY_REQUIRED', 'API_KEY is required.'],
  );

  process.env.API_KEY ||= 'built-runtime-smoke-api-key';
  const { buildServer } = require(serverPath);
  const loadedSummaryModules = Object.keys(require.cache).filter((modulePath) => {
    const normalized = modulePath.replaceAll('\\', '/');
    return normalized.includes('/gemini-provider.') ||
      normalized.includes('/summarizer.') ||
      normalized.includes('/@google/genai/');
  });
  assert.deepEqual(loadedSummaryModules, []);

  const { AudioExtractionService } = require(
    path.join(repoRoot, 'packages/server/dist/services/audio-extractor.js'),
  );
  const { FileManagerService } = require(
    path.join(repoRoot, 'packages/server/dist/services/file-manager.js'),
  );
  const { processMeetingJob } = require(
    path.join(repoRoot, 'packages/server/dist/services/queue.js'),
  );
  const { TranscriptionService } = require(
    path.join(repoRoot, 'packages/server/dist/services/transcriber.js'),
  );
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'built-processing-smoke-'));
  const artifacts = new FileManagerService(artifactRoot);
  await artifacts.ensureDirectories();
  const jobs = [];
  const jobStore = {
    async getAll() {
      return jobs;
    },
    async getById(id) {
      return jobs.find((job) => job.id === id);
    },
    async replace(job) {
      const index = jobs.findIndex((candidate) => candidate.id === job.id);
      if (index === -1) jobs.push(job);
      else jobs[index] = job;
    },
    async delete() {},
  };
  const processingDependencies = {
    jobStore,
    artifacts,
    audioExtractor: new AudioExtractionService(),
    transcriber: new TranscriptionService({
      executablePath: process.execPath,
      scriptPath: path.join(
        repoRoot,
        'packages/server/tests/fixtures/fake-whisper.mjs',
      ),
      environment: {
        ...process.env,
        HUGGING_FACE_TOKEN: 'sentinel-hf-token',
        FAKE_WHISPER_MODE: 'success',
        FAKE_WHISPER_PROTOCOL_PATH: path.join(artifactRoot, 'protocol.json'),
        FAKE_WHISPER_TRANSCRIPT_CANARY: 'Built runtime Transcript sentinel',
      },
    }),
  };
  let processing;
  const jobQueue = {
    push(input) {
      processing = processMeetingJob(input, processingDependencies);
    },
  };
  const server = buildServer({
    apiKey: process.env.API_KEY,
    dependencies: { artifacts, jobQueue, jobStore },
  });

  try {
    await server.ready();
    const response = await server.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-api-key': process.env.API_KEY },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'online',
      service: 'Meeting Summarizer Server',
    });

    const form = new FormData();
    form.append(
      'file',
      fs.readFileSync(path.join(
        repoRoot,
        'packages/server/tests/fixtures/short-recording.wav',
      )),
      { filename: 'short-recording.wav', contentType: 'audio/wav' },
    );
    const accepted = await server.inject({
      method: 'POST',
      url: '/jobs',
      headers: {
        ...form.getHeaders(),
        'x-api-key': process.env.API_KEY,
        'x-job-id': 'built-runtime-job',
        'x-recorded-at': '2026-08-20T12:00:00.000Z',
      },
      payload: form.getBuffer(),
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    await processing;

    const status = await server.inject({
      method: 'GET',
      url: '/jobs/built-runtime-job',
      headers: { 'x-api-key': process.env.API_KEY },
    });
    assert.equal(status.statusCode, 200, status.body);
    assert.equal(status.json().serverStatus, 'COMPLETED');
    assert.equal(status.json().currentStep, 'TRANSCRIPT_READY');

    const transcript = await server.inject({
      method: 'GET',
      url: '/jobs/built-runtime-job/transcript',
      headers: { 'x-api-key': process.env.API_KEY },
    });
    assert.equal(transcript.statusCode, 200, transcript.body);
    assert.equal(transcript.body, 'Built runtime Transcript sentinel');
  } finally {
    await server.close();
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
}

await smokeClient();
await smokeServer();
console.log('Built runtime smoke passed.');
