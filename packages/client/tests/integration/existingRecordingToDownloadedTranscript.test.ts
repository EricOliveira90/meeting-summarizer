import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  AIPromptTemplate,
  JobStep,
  TranscriptionLanguage,
  type JobResponse,
} from '@meeting-summarizer/shared';
import { ClientJobStatus, type ClientJob } from '../../src/domain';
import { runSync } from '../../src/commands/sync';
import { ApiService } from '../../src/services/api';
import { configService } from '../../src/services/config';
import { LowDB } from '../../src/services/db';
import { SyncManager } from '../../src/services/syncManager';
import { NodeFileSystem } from '../../src/utils/nodeFS';
import type { JobRecord } from '../../../server/src/domain/models';

vi.mock('../../../server/src/services/gemini-provider', () => {
  throw new Error('Integrated transcription journey loaded a Summary Provider.');
});
vi.mock('../../../server/src/services/summarizer', () => {
  throw new Error('Integrated transcription journey loaded SummaryService.');
});

const API_KEY = 'acceptance-api-key-sentinel';
const PROCESS_CREDENTIAL = 'process-credential-sentinel';
const SUMMARY_SENTINEL = 'summary-text-sentinel';
const TRANSCRIPT = [
  'Speaker 1: Welcome to the release review.',
  'Speaker 2: The transcript is ready for local summarization.',
].join('\n');
const RECORDED_AT = '2026-08-20T09:30:00-03:00';
const NORMALIZED_RECORDED_AT = '2026-08-20T12:30:00.000Z';

interface SuccessOutcome {
  clientJobs: ClientJob[];
  serverJobs: JobRecord[];
  creationRequests: number;
  observedStatuses: JobResponse[];
  artifactRoot: string;
  transcriptPath: string;
  transcriptText: string;
  temporaryFiles: string[];
  summaryArtifacts: string[];
  publicationArtifacts: string[];
  noteCalls: number;
}

interface RejectionOutcome {
  responses: Array<{
    status: number;
    body: { code: string; error: string };
  }>;
  serverJobs: JobRecord[];
  queuePushes: number;
  notebookTranscripts: string[];
}

describe('Existing Recording to downloaded Transcript', () => {
  it('moves one persisted Recording through ordered server states to one atomic local Transcript', async () => {
    const outcome = await runIntegratedSuccessJourney();

    expect(outcome.creationRequests).toBe(1);
    expect(outcome.clientJobs).toHaveLength(1);
    expect(outcome.serverJobs).toHaveLength(1);

    const clientJob = outcome.clientJobs[0];
    expect(clientJob).toMatchObject({
      id: outcome.serverJobs[0].id,
      recordedAt: RECORDED_AT,
      clientStatus: ClientJobStatus.READY,
      retryCount: 0,
      options: {
        language: TranscriptionLanguage.ENGLISH,
        template: AIPromptTemplate.MEETING,
        minSpeakers: 2,
        maxSpeakers: 5,
      },
    });
    expect(outcome.serverJobs[0]).toMatchObject({
      id: clientJob.id,
      originalFilename: clientJob.originalFilename,
      recordedAt: NORMALIZED_RECORDED_AT,
      serverStatus: 'COMPLETED',
      currentStep: JobStep.TRANSCRIPT_READY,
      options: clientJob.options,
    });

    expect(outcome.observedStatuses.map(({ serverStatus, currentStep }) => ({
      serverStatus,
      currentStep,
    }))).toEqual([
      { serverStatus: 'PENDING', currentStep: JobStep.QUEUED },
      { serverStatus: 'PROCESSING', currentStep: JobStep.EXTRACTING_AUDIO },
      { serverStatus: 'PROCESSING', currentStep: JobStep.TRANSCRIBING },
      { serverStatus: 'COMPLETED', currentStep: JobStep.TRANSCRIPT_READY },
    ]);
    expectOrderedTimestamps(outcome.serverJobs[0]);
    for (const status of outcome.observedStatuses) {
      expectRedactedStatus(status, outcome.artifactRoot);
    }

    expect(path.basename(outcome.transcriptPath)).toBe(
      'existing-release-review_transcription.txt',
    );
    expect(outcome.transcriptText).toBe(TRANSCRIPT);
    expect(outcome.temporaryFiles).toEqual([]);
    expect(outcome.summaryArtifacts).toEqual([]);
    expect(outcome.publicationArtifacts).toEqual([]);
    expect(outcome.noteCalls).toBe(0);
  });

  it('rejects missing auth, wrong auth, and invalid language without creating a Job', async () => {
    const outcome = await runCreationRejectionJourney();

    expect(outcome.responses).toEqual([
      {
        status: 401,
        body: {
          code: 'AUTH_REQUIRED',
          error: 'API credential is required.',
        },
      },
      {
        status: 401,
        body: {
          code: 'AUTH_INVALID',
          error: 'API credential is invalid.',
        },
      },
      {
        status: 400,
        body: {
          code: 'INVALID_LANGUAGE',
          error: 'x-language must be one of: auto, en, pt, es.',
        },
      },
    ]);
    expect(outcome.serverJobs).toEqual([]);
    expect(outcome.queuePushes).toBe(0);
    expect(outcome.notebookTranscripts).toEqual([]);
  });
});

function expectOrderedTimestamps(job: JobRecord): void {
  const steps = [
    JobStep.QUEUED,
    JobStep.EXTRACTING_AUDIO,
    JobStep.TRANSCRIBING,
    JobStep.TRANSCRIPT_READY,
  ];

  for (let index = 1; index < steps.length; index += 1) {
    const previous = job.steps?.[steps[index - 1]];
    const current = job.steps?.[steps[index]];
    expect(previous?.completedAt).toEqual(expect.any(String));
    expect(current?.startedAt).toEqual(expect.any(String));
    expect(Date.parse(previous!.completedAt!)).toBeLessThanOrEqual(
      Date.parse(current!.startedAt),
    );
  }
}

function expectRedactedStatus(status: JobResponse, artifactRoot: string): void {
  const serialized = JSON.stringify(status);
  const prohibitedKeys = [
    'filePath',
    'uploadPath',
    'audioPath',
    'transcriptPath',
    'summaryPath',
    'transcriptText',
    'summaryText',
  ];

  for (const key of prohibitedKeys) {
    expect(serialized).not.toContain(`"${key}"`);
  }
  for (const sentinel of [
    artifactRoot,
    TRANSCRIPT,
    SUMMARY_SENTINEL,
    API_KEY,
    PROCESS_CREDENTIAL,
  ]) {
    expect(serialized).not.toContain(sentinel);
  }
}

async function runIntegratedSuccessJourney(): Promise<SuccessOutcome> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'existing-recording-'));
  const clientRoot = path.join(root, 'notebook');
  const serverRoot = path.join(root, 'server');
  const recordingPath = path.join(
    clientRoot,
    'recordings',
    'existing-release-review.mkv',
  );
  await fs.mkdir(serverRoot, { recursive: true });
  const clientFileSystem = new NodeFileSystem(clientRoot);
  await clientFileSystem.writeFile(recordingPath, 'existing Recording bytes');

  const originalCwd = process.cwd();
  vi.resetModules();
  process.chdir(serverRoot);
  const [{ buildServer }, { jobStore }, { FileManagerService }, queueModule] =
    await Promise.all([
      import('../../../server/src/index'),
      import('../../../server/src/services/db'),
      import('../../../server/src/services/file-manager'),
      import('../../../server/src/services/queue'),
    ]);
  process.chdir(originalCwd);

  const artifacts = new FileManagerService(serverRoot);
  await artifacts.ensureDirectories();
  const extractionGate = deferred();
  const transcriptionGate = deferred();
  const extractionEntered = deferred();
  const transcriptionEntered = deferred();
  const processingDependencies = {
    jobStore,
    artifacts,
    audioExtractor: {
      async convertToWav(_inputPath: string, outputPath: string) {
        extractionEntered.resolve();
        await extractionGate.promise;
        await fs.writeFile(outputPath, 'extracted audio');
        return { audioPath: outputPath };
      },
    },
    transcriber: {
      async transcribe(_audioPath: string, outputPath: string) {
        void PROCESS_CREDENTIAL;
        transcriptionEntered.resolve();
        await transcriptionGate.promise;
        await fs.writeFile(outputPath, TRANSCRIPT);
        return { outputFilePath: outputPath };
      },
    },
  };
  const queue = queueModule.createMeetingQueue(processingDependencies) as
    ReturnType<typeof queueModule.createMeetingQueue> & {
      pause(): void;
      resume(): void;
      destroy(callback: () => void): void;
    };
  queue.pause();

  const app = buildServer({
    apiKey: API_KEY,
    dependencies: { artifacts, jobQueue: queue, jobStore },
  });
  let creationRequests = 0;
  app.server.on('request', (request) => {
    if (request.method === 'POST' && request.url === '/jobs') {
      creationRequests += 1;
    }
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Acceptance server did not expose a TCP port.');
  }

  const originalConfigGet = configService.get.bind(configService);
  const configGet = vi.spyOn(configService, 'get').mockImplementation(
    ((key: Parameters<typeof configService.get>[0]) => {
      if (key === 'server') {
        return {
          ip: '127.0.0.1',
          port: address.port,
          apiKey: API_KEY,
        };
      }
      return originalConfigGet(key);
    }) as typeof configService.get,
  );
  const api = new ApiService();
  const db = new LowDB(
    clientFileSystem,
    path.join(clientRoot, 'client-db.json'),
  );
  const persistedJob = await db.addRecording(recordingPath, RECORDED_AT);
  await db.updateOptions(persistedJob.id, {
    language: TranscriptionLanguage.ENGLISH,
    template: AIPromptTemplate.MEETING,
    minSpeakers: 2,
    maxSpeakers: 5,
  });
  const note = { saveNote: vi.fn() };
  const ingestion = {
    scanDirectory: vi.fn(async () => {}),
    ingestFile: vi.fn(async () => {}),
  };
  const syncManager = new SyncManager(
    api,
    db,
    note,
    ingestion,
    clientFileSystem,
  );
  const observedStatuses: JobResponse[] = [];

  try {
    await runSync(syncManager);
    observedStatuses.push(await api.getJobStatus(persistedJob.id));

    await runSync(syncManager);
    expect(creationRequests).toBe(1);

    queue.resume();
    await extractionEntered.promise;
    await runSync(syncManager);
    observedStatuses.push(await api.getJobStatus(persistedJob.id));

    extractionGate.resolve();
    await transcriptionEntered.promise;
    await runSync(syncManager);
    observedStatuses.push(await api.getJobStatus(persistedJob.id));

    transcriptionGate.resolve();
    await waitFor(async () => {
      const job = await jobStore.getById(persistedJob.id);
      return job?.currentStep === JobStep.TRANSCRIPT_READY;
    });
    await runSync(syncManager);
    observedStatuses.push(await api.getJobStatus(persistedJob.id));

    const transcriptPath = clientFileSystem.joinPathsInProjectFolder(
      'transcriptions',
      'existing-release-review_transcription.txt',
    );
    return {
      clientJobs: await db.getAll(),
      serverJobs: (await jobStore.getAll()).map((job) => structuredClone(job)),
      creationRequests,
      observedStatuses,
      artifactRoot: serverRoot,
      transcriptPath,
      transcriptText: await clientFileSystem.readFile(transcriptPath),
      temporaryFiles: (await listFiles(path.dirname(transcriptPath)))
        .filter((file) => file.endsWith('.tmp')),
      summaryArtifacts: [
        ...await listFiles(path.join(clientRoot, 'summaries')),
        ...await listFiles(path.join(serverRoot, 'summaries')),
      ],
      publicationArtifacts: await listFiles(
        path.join(clientRoot, 'publications'),
      ),
      noteCalls: note.saveNote.mock.calls.length,
    };
  } finally {
    extractionGate.resolve();
    transcriptionGate.resolve();
    queue.resume();
    await app.close();
    await new Promise<void>((resolve) => queue.destroy(resolve));
    api.resetClient();
    configGet.mockRestore();
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runCreationRejectionJourney(): Promise<RejectionOutcome> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'creation-rejection-'));
  const clientRoot = path.join(root, 'notebook');
  const serverRoot = path.join(root, 'server');
  await fs.mkdir(serverRoot, { recursive: true });

  const originalCwd = process.cwd();
  vi.resetModules();
  process.chdir(serverRoot);
  const [{ buildServer }, { jobStore }, { FileManagerService }, queueModule] =
    await Promise.all([
      import('../../../server/src/index'),
      import('../../../server/src/services/db'),
      import('../../../server/src/services/file-manager'),
      import('../../../server/src/services/queue'),
    ]);
  process.chdir(originalCwd);

  const artifacts = new FileManagerService(serverRoot);
  await artifacts.ensureDirectories();
  const queue = queueModule.createMeetingQueue({
    jobStore,
    artifacts,
    audioExtractor: {
      convertToWav: vi.fn(async () => {
        throw new Error('Rejected creation reached extraction.');
      }),
    },
    transcriber: {
      transcribe: vi.fn(async () => {
        throw new Error('Rejected creation reached transcription.');
      }),
    },
  }) as ReturnType<typeof queueModule.createMeetingQueue> & {
    destroy(callback: () => void): void;
  };
  const queuePush = vi.spyOn(queue, 'push');
  const app = buildServer({
    apiKey: API_KEY,
    dependencies: { artifacts, jobQueue: queue, jobStore },
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Acceptance server did not expose a TCP port.');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const request = async (
    apiKey: string | undefined,
    language: string,
  ): Promise<RejectionOutcome['responses'][number]> => {
    const form = new FormData();
    form.append(
      'file',
      new Blob(['existing Recording bytes'], { type: 'video/x-matroska' }),
      'existing-recording.mkv',
    );
    const headers: Record<string, string> = {
      'x-job-id': `rejected-${language}-${apiKey ?? 'missing'}`,
      'x-recorded-at': RECORDED_AT,
      'x-language': language,
      'x-template': AIPromptTemplate.MEETING,
    };
    if (apiKey !== undefined) headers['x-api-key'] = apiKey;

    const response = await fetch(`${baseUrl}/jobs`, {
      method: 'POST',
      headers,
      body: form,
    });
    return {
      status: response.status,
      body: await response.json() as RejectionOutcome['responses'][number]['body'],
    };
  };

  try {
    const responses = [
      await request(undefined, TranscriptionLanguage.ENGLISH),
      await request('wrong-api-key-sentinel', TranscriptionLanguage.ENGLISH),
      await request(API_KEY, 'fr'),
    ];
    return {
      responses,
      serverJobs: await jobStore.getAll(),
      queuePushes: queuePush.mock.calls.length,
      notebookTranscripts: await listFiles(
        path.join(clientRoot, 'transcriptions'),
      ),
    };
  } finally {
    warning.mockRestore();
    await app.close();
    await new Promise<void>((resolve) => queue.destroy(resolve));
    process.chdir(originalCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!await predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for integrated processing state.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
