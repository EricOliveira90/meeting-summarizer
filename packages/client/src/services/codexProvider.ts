import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  CodexReadiness,
  SummaryInput,
  SummaryProvider,
  SummaryProviderFailure,
  SummaryProviderResult,
} from '../domain';
import { SUMMARY_PROMPTS } from '../templates/summaryPrompts';

const MANAGED_CREDENTIAL_MESSAGE =
  'Login is not required. OpenAI Codex uses Bedrock via managed credentials.';
const WRAPPER_ERROR_PREFIX = 'codex-wrapper: error: ';

export interface CodexProviderOptions {
  model?: string;
  executablePath?: string;
  executableArgs?: string[];
  environment?: NodeJS.ProcessEnv;
  tempDirectory?: string;
  timeoutMs?: number;
  stdoutLimitBytes?: number;
  stderrLimitBytes?: number;
  finalMessageLimitBytes?: number;
  finalMessagePollIntervalMs?: number;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnFailed: boolean;
  cancelled: boolean;
  timedOut: boolean;
  outputOverflow: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_STREAM_LIMIT_BYTES = 64 * 1024;
const DEFAULT_FINAL_MESSAGE_LIMIT_BYTES = 1024 * 1024;

function codexExecArgs(model: string, outputPath: string): string[] {
  return [
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    '--model',
    model,
    '--color',
    'never',
    '--output-last-message',
    outputPath,
    '-',
  ];
}

function runProcess(
  args: string[],
  options: CodexProviderOptions,
  stdin?: string,
  signal?: AbortSignal,
  outputPath?: string,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const stdoutLimit =
      options.stdoutLimitBytes ?? DEFAULT_STREAM_LIMIT_BYTES;
    const stderrLimit =
      options.stderrLimitBytes ?? DEFAULT_STREAM_LIMIT_BYTES;
    const finalMessageLimit =
      options.finalMessageLimitBytes ?? DEFAULT_FINAL_MESSAGE_LIMIT_BYTES;
    const child = spawn(
      options.executablePath ?? 'codex',
      [...(options.executableArgs ?? []), ...args],
      {
        shell: false,
        windowsHide: true,
        env: options.environment ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let cancelled = false;
    let timedOut = false;
    let outputOverflow = false;

    const terminate = () => {
      if (child.exitCode === null && !child.killed) {
        child.kill();
      }
    };
    const markOverflow = () => {
      outputOverflow = true;
      terminate();
    };
    const capture = (
      chunks: Buffer[],
      chunk: Buffer,
      bytes: number,
      limit: number,
    ): number => {
      const remaining = Math.max(0, limit + 1 - bytes);
      if (remaining > 0) {
        chunks.push(Buffer.from(chunk.subarray(0, remaining)));
        bytes += Math.min(chunk.length, remaining);
      }
      if (bytes > limit) markOverflow();
      return bytes;
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const abort = () => {
      cancelled = true;
      terminate();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const fileMonitor = outputPath
      ? setInterval(async () => {
          try {
            const stats = await fs.stat(outputPath);
            if (stats.size > finalMessageLimit) markOverflow();
          } catch {}
        }, options.finalMessagePollIntervalMs ?? 10)
      : undefined;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (fileMonitor) clearInterval(fileMonitor);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes = capture(stdout, chunk, stdoutBytes, stdoutLimit);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBytes = capture(stderr, chunk, stderrBytes, stderrLimit);
    });
    child.once('error', () => {
      finish({
        exitCode: null,
        stdout: '',
        stderr: '',
        spawnFailed: true,
        cancelled,
        timedOut,
        outputOverflow,
      });
    });
    child.once('close', async (exitCode) => {
      if (outputPath) {
        try {
          const stats = await fs.stat(outputPath);
          if (stats.size > finalMessageLimit) outputOverflow = true;
        } catch {}
      }
      finish({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        spawnFailed: false,
        cancelled,
        timedOut,
        outputOverflow,
      });
    });

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }
  });
}

async function readBoundedFile(
  filePath: string,
  limit: number,
): Promise<{ output: string; overflow: boolean }> {
  const file = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return {
      output: buffer.subarray(0, bytesRead).toString('utf8'),
      overflow: bytesRead > limit,
    };
  } finally {
    await file.close();
  }
}

function notChecked() {
  return { status: 'not_checked' as const };
}

function normalizeFinalMessage(output: string): string {
  return output.replace(/\r\n/g, '\n').trim();
}

function classifyProcessFailure(
  result: ProcessResult,
): SummaryProviderFailure | undefined {
  if (result.cancelled) {
    return {
      category: 'CANCELLED',
      retryable: true,
      message: 'Codex was cancelled.',
    };
  }
  if (result.timedOut) {
    return {
      category: 'TIMEOUT',
      retryable: true,
      message: 'Codex timed out.',
    };
  }
  if (result.spawnFailed) {
    return {
      category: 'PROCESS',
      retryable: false,
      message: 'Codex could not be started.',
    };
  }
  if (result.stderr.includes('Not logged in')) {
    return {
      category: 'AUTHENTICATION',
      retryable: false,
      message: 'Codex authentication is unavailable.',
    };
  }
  if (result.stderr.toLowerCase().includes('permission denied')) {
    return {
      category: 'PERMISSION',
      retryable: false,
      message: 'Codex permission was denied.',
    };
  }
  if (result.stderr.includes('model "missing-model" is not supported')) {
    return {
      category: 'MODEL',
      retryable: false,
      message: 'The selected Codex model is unavailable.',
    };
  }
  if (result.exitCode !== 0) {
    return {
      category: 'PROCESS',
      retryable: true,
      message: `Codex failed (exit ${result.exitCode ?? 'unknown'}).`,
    };
  }
  return undefined;
}

export async function checkCodexReadiness(
  model: string,
  options: CodexProviderOptions = {},
): Promise<CodexReadiness> {
  const version = await runProcess(['--version'], options);
  if (
    version.spawnFailed ||
    version.exitCode !== 0 ||
    version.stdout.trim().length === 0
  ) {
    return {
      executable: {
        status: 'failed',
        reason: 'Codex executable is unavailable.',
      },
      authentication: notChecked(),
      model: notChecked(),
    };
  }

  const login = await runProcess(['login', 'status'], options);
  const authenticationMessage = login.stderr
    .trim()
    .replace(WRAPPER_ERROR_PREFIX, '');
  const authenticationReady =
    login.exitCode === 0 ||
    (login.exitCode === 1 &&
      authenticationMessage === MANAGED_CREDENTIAL_MESSAGE);
  if (!authenticationReady) {
    return {
      executable: { status: 'ready' },
      authentication: {
        status: 'failed',
        reason: 'Codex authentication is unavailable.',
      },
      model: notChecked(),
    };
  }

  const outputPath = path.join(
    os.tmpdir(),
    `meeting-summarizer-codex-${randomUUID()}.txt`,
  );
  try {
    const probe = await runProcess(
      codexExecArgs(model, outputPath),
      options,
      'Reply with exactly READY.',
      undefined,
      outputPath,
    );
    let output = '';
    try {
      const finalMessage = await readBoundedFile(
        outputPath,
        options.finalMessageLimitBytes ?? DEFAULT_FINAL_MESSAGE_LIMIT_BYTES,
      );
      if (!finalMessage.overflow) output = finalMessage.output;
    } catch {}

    if (
      probe.outputOverflow ||
      probe.exitCode !== 0 ||
      output.replace(/\r\n/g, '\n').trim() !== 'READY'
    ) {
      return {
        executable: { status: 'ready' },
        authentication: { status: 'ready' },
        model: {
          status: 'failed',
          reason: 'The selected Codex model is unavailable.',
        },
      };
    }

    return {
      executable: { status: 'ready' },
      authentication: { status: 'ready' },
      model: { status: 'ready' },
    };
  } finally {
    await fs.rm(outputPath, { force: true });
  }
}

export class CodexProvider implements SummaryProvider {
  public readonly name = 'codex';
  private readonly model: string;

  constructor(private readonly options: CodexProviderOptions = {}) {
    this.model = options.model ?? 'gpt-5-codex';
  }

  public checkAvailability(): Promise<CodexReadiness> {
    return checkCodexReadiness(this.model, this.options);
  }

  public async summarize(
    input: SummaryInput,
    signal?: AbortSignal,
  ): Promise<SummaryProviderResult> {
    const outputPath = path.join(
      this.options.tempDirectory ?? os.tmpdir(),
      `meeting-summarizer-codex-${randomUUID()}.txt`,
    );
    const prompt =
      `${SUMMARY_PROMPTS[input.template]}\n\nTranscript:\n${input.transcript}`;
    try {
      const result = await runProcess(
        codexExecArgs(this.model, outputPath),
        this.options,
        prompt,
        signal,
        outputPath,
      );

      if (result.cancelled || result.timedOut) {
        return {
          success: false,
          error: classifyProcessFailure(result)!,
        };
      }

      if (result.outputOverflow) {
        return {
          success: false,
          error: {
            category: 'PROCESS',
            retryable: true,
            message: 'Codex output exceeded the capture limit.',
          },
        };
      }

      const processFailure = classifyProcessFailure(result);
      if (processFailure) {
        return { success: false, error: processFailure };
      }

      let finalMessage = { output: '', overflow: false };
      try {
        finalMessage = await readBoundedFile(
          outputPath,
          this.options.finalMessageLimitBytes ??
            DEFAULT_FINAL_MESSAGE_LIMIT_BYTES,
        );
      } catch {}
      if (finalMessage.overflow) {
        return {
          success: false,
          error: {
            category: 'PROCESS',
            retryable: true,
            message: 'Codex output exceeded the capture limit.',
          },
        };
      }

      const summary = normalizeFinalMessage(finalMessage.output);
      if (!summary) {
        return {
          success: false,
          error: {
            category: 'MALFORMED_OUTPUT',
            retryable: true,
            message: 'Codex returned no Summary.',
          },
        };
      }

      return { success: true, summary };
    } finally {
      await fs.rm(outputPath, { force: true });
    }
  }
}
