import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  TranscriptionLanguage,
  AIPromptTemplate,
  UploadResponse,
  ErrorResponse,
  JobStep,
} from '@meeting-summarizer/shared';
import { JobRecord } from '../domain/models';

const JOB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ZONED_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const LANGUAGES = Object.values(TranscriptionLanguage);
const TEMPLATES = Object.values(AIPromptTemplate);
const MAX_RECORDING_BYTES = 524_288_000;
const MEDIA_TYPES: Record<string, string> = {
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};

interface SpeakerBound {
  valid: boolean;
  value?: number;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeRecordedAt(value: string | undefined): string | null {
  const match = value?.match(ZONED_TIMESTAMP_PATTERN);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const [zoneHour, zoneMinute] = zone === 'Z'
    ? [0, 0]
    : zone.slice(1).split(':').map(Number);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseSpeakerBound(value: string | undefined): SpeakerBound {
  if (value === undefined) return { valid: true };
  if (!/^[1-9]\d*$/.test(value)) return { valid: false };

  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? { valid: true, value: parsed }
    : { valid: false };
}

async function requireContent(source: Readable): Promise<Readable | null> {
  const iterator = source[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) return null;

  return Readable.from((async function* () {
    yield first.value;
    while (true) {
      const next = await iterator.next();
      if (next.done) return;
      yield next.value;
    }
  })());
}

export async function uploadRoutes(server: FastifyInstance) {
  const artifacts = server.artifacts;

  const createJob = async (req: FastifyRequest, reply: FastifyReply) => {
    const jobId = headerValue(req.headers['x-job-id']);
    if (!jobId || !JOB_ID_PATTERN.test(jobId)) {
      return reply.status(400).send({
        code: 'INVALID_JOB_ID',
        error: 'x-job-id must contain 1-128 letters, digits, hyphens, or underscores and start with a letter or digit.',
      });
    }

    const recordedAt = normalizeRecordedAt(headerValue(req.headers['x-recorded-at']));
    if (!recordedAt) {
      return reply.status(400).send({
        code: 'INVALID_RECORDED_AT',
        error: 'x-recorded-at must be a valid ISO-8601 timestamp.',
      });
    }

    const languageHeader = headerValue(req.headers['x-language']);
    if (languageHeader !== undefined && !LANGUAGES.includes(languageHeader as TranscriptionLanguage)) {
      return reply.status(400).send({
        code: 'INVALID_LANGUAGE',
        error: 'x-language must be one of: auto, en, pt, es.',
      });
    }
    const language = (languageHeader as TranscriptionLanguage | undefined) ?? TranscriptionLanguage.AUTO;

    const templateHeader = headerValue(req.headers['x-template']);
    if (templateHeader !== undefined && !TEMPLATES.includes(templateHeader as AIPromptTemplate)) {
      return reply.status(400).send({
        code: 'INVALID_TEMPLATE',
        error: 'x-template must be one of: meeting, training, summary.',
      });
    }
    const template = (templateHeader as AIPromptTemplate | undefined) ?? AIPromptTemplate.MEETING;

    const minimum = parseSpeakerBound(headerValue(req.headers['x-min-speakers']));
    const maximum = parseSpeakerBound(headerValue(req.headers['x-max-speakers']));
    if (!minimum.valid || !maximum.valid) {
      return reply.status(400).send({
        code: 'INVALID_SPEAKER_BOUND',
        error: 'Speaker bounds must be positive integers.',
      });
    }
    const minSpeakers = minimum.value;
    const maxSpeakers = maximum.value;
    if (minSpeakers !== undefined && maxSpeakers !== undefined && minSpeakers > maxSpeakers) {
      return reply.status(400).send({
        code: 'INVALID_SPEAKER_RANGE',
        error: 'x-min-speakers must not exceed x-max-speakers.',
      });
    }

    const data = await req.file();

    if (!data) {
      return reply.status(400).send({
        code: 'FILE_REQUIRED',
        error: 'A Recording file is required.',
      });
    }

    const extension = path.extname(data.filename).toLowerCase();
    if (MEDIA_TYPES[extension] !== data.mimetype) {
      return reply.status(415).send({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        error: 'Recording extension and MIME type are not a supported pair.',
      });
    }

    const recording = await requireContent(data.file);
    if (!recording) {
      return reply.status(400).send({
        code: 'EMPTY_RECORDING',
        error: 'Recording file must not be empty.',
      });
    }

    const safeOriginalName = data.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const savePath = artifacts.getUploadPath(jobId, safeOriginalName);
    let stagedPath: string | undefined;

    try {
      const staged = await artifacts.stageRecording(savePath, recording);
      stagedPath = staged.stagedPath;
      if (staged.size > MAX_RECORDING_BYTES || data.file.truncated) {
        await artifacts.deleteRecording(staged.stagedPath);
        return reply.status(413).send({
          code: 'UPLOAD_TOO_LARGE',
          error: 'Recording exceeds the 500 MiB limit.',
        });
      }
      await artifacts.commitRecording(staged.stagedPath, savePath);

      const options = {
        language,
        template,
        ...(minSpeakers === undefined ? {} : { minSpeakers }),
        ...(maxSpeakers === undefined ? {} : { maxSpeakers }),
      };
      const queuedAt = new Date().toISOString();
      const newJob: JobRecord = {
        id: jobId,
        originalFilename: data.filename,
        filePath: savePath,
        recordedAt,
        serverStatus: 'PENDING',
        currentStep: JobStep.QUEUED,
        steps: {
          [JobStep.QUEUED]: {
            startedAt: queuedAt,
            completedAt: queuedAt,
          },
        },
        options,
      };

      await server.jobStore.replace(newJob);
      server.jobQueue.push({ jobId, filePath: savePath });
    } catch {
      if (stagedPath) await artifacts.deleteRecording(stagedPath);
      await artifacts.deleteRecording(savePath);
      return reply.status(500).send({ error: 'Stream processing failed' });
    }

    return { success: true, jobId, message: 'File queued.' };
  };

  server.post<{ Reply: UploadResponse | ErrorResponse }>('/jobs', createJob);
  server.post<{ Reply: UploadResponse | ErrorResponse }>('/upload', createJob);
}
