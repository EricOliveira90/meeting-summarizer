import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIPromptTemplate } from '@meeting-summarizer/shared';
import { CodexProvider } from '../../src/services/codexProvider';
import { SUMMARY_PROMPTS } from '../../src/templates/summaryPrompts';

const MODEL_CANARY = 'model-canary';
const TRANSCRIPT_CANARY = 'Speaker 7: TRANSCRIPT-CANARY';
const fakeCodexPath = path.resolve(
  __dirname,
  '..',
  'fixtures',
  'fake-codex.mjs',
);

describe('CodexProvider', () => {
  let tempDir: string;
  let protocolPath: string;
  let logs: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-provider-'));
    protocolPath = path.join(tempDir, 'protocol.jsonl');
    logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    for (const log of logs) log.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createProvider(mode: string) {
    return new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: mode,
        FAKE_CODEX_PROTOCOL_PATH: protocolPath,
      },
      tempDirectory: tempDir,
    });
  }

  it('creates a normalized Summary through the exact non-interactive protocol', async () => {
    const provider = createProvider('summary-success');

    const result = await provider.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.TRAINING,
    });

    expect(result).toEqual({
      success: true,
      summary: '## Training Summary\n\n- Exact final message',
    });
    const [protocol] = fs
      .readFileSync(protocolPath, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse);
    expect(protocol.args).toEqual([
      'exec',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox',
      'read-only',
      '-c',
      'approval_policy="never"',
      '--model',
      MODEL_CANARY,
      '--color',
      'never',
      '--output-last-message',
      expect.any(String),
      '-',
    ]);
    expect(protocol.stdin).toBe(
      `${SUMMARY_PROMPTS[AIPromptTemplate.TRAINING]}\n\nTranscript:\n${TRANSCRIPT_CANARY}`,
    );
    expect(protocol.args.join(' ')).not.toContain(TRANSCRIPT_CANARY);
    expect(protocol.args.join(' ')).not.toContain(
      SUMMARY_PROMPTS[AIPromptTemplate.TRAINING],
    );
    expect(result.summary).not.toContain('STDOUT IS NOT THE SUMMARY');
  });

  it('normalizes arbitrary non-empty final-message text', async () => {
    const result = await createProvider('normalized-output').summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.SUMMARY,
    });

    expect(result).toEqual({
      success: true,
      summary: 'Arbitrary final text\nwith a second line',
    });
  });

  it('rejects an empty normalized final message', async () => {
    const result = await createProvider('empty-output').summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    });

    expect(result).toEqual({
      success: false,
      error: {
        category: 'MALFORMED_OUTPUT',
        retryable: true,
        message: 'Codex returned no Summary.',
      },
    });
  });

  it.each([
    'stdout-overflow',
    'stderr-overflow',
    'file-overflow',
  ])('bounds and terminates live Codex after %s', async (mode) => {
    const pidPath = path.join(tempDir, `${mode}.pid`);
    const provider = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: mode,
        FAKE_CODEX_PROTOCOL_PATH: protocolPath,
        FAKE_CODEX_PID_PATH: pidPath,
      },
      tempDirectory: tempDir,
      stdoutLimitBytes: 8,
      stderrLimitBytes: 8,
      finalMessageLimitBytes: 8,
    });

    const result = await provider.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    });

    expect(result).toEqual({
      success: false,
      error: {
        category: 'PROCESS',
        retryable: true,
        message: 'Codex output exceeded the capture limit.',
      },
    });
    const pid = Number(fs.readFileSync(pidPath, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it.each([
    { outcome: 'success', mode: 'summary-success' },
    { outcome: 'malformed output', mode: 'empty-output' },
    { outcome: 'nonzero exit', mode: 'process-failure' },
    { outcome: 'stdout overflow', mode: 'stdout-overflow', limit: 8 },
    { outcome: 'stderr overflow', mode: 'stderr-overflow', limit: 8 },
    { outcome: 'file overflow', mode: 'file-overflow', limit: 8 },
    { outcome: 'timeout', mode: 'hang', timeoutMs: 20 },
  ])('removes the final-message file after $outcome', async ({
    mode,
    limit,
    timeoutMs,
  }) => {
    const provider = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: mode,
        FAKE_CODEX_PROTOCOL_PATH: protocolPath,
      },
      tempDirectory: tempDir,
      timeoutMs,
      stdoutLimitBytes: limit,
      stderrLimitBytes: limit,
      finalMessageLimitBytes: limit,
    });

    await provider.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    });

    expect(
      fs.readdirSync(tempDir).filter((name) =>
        name.startsWith('meeting-summarizer-codex-'),
      ),
    ).toEqual([]);
  });

  it('removes the final-message file after cancellation and spawn failure', async () => {
    const controller = new AbortController();
    const cancelled = createProvider('hang').summarize(
      {
        transcript: TRANSCRIPT_CANARY,
        template: AIPromptTemplate.MEETING,
      },
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(
        fs.readdirSync(tempDir).some((name) =>
          name.startsWith('meeting-summarizer-codex-'),
        ),
      ).toBe(true);
    });
    controller.abort();
    await cancelled;

    const missingExecutable = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: path.join(tempDir, 'missing-codex'),
      tempDirectory: tempDir,
    });
    await missingExecutable.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    });

    expect(
      fs.readdirSync(tempDir).filter((name) =>
        name.startsWith('meeting-summarizer-codex-'),
      ),
    ).toEqual([]);
  });

  it.each([
    {
      mode: 'authentication-failure',
      expected: {
        category: 'AUTHENTICATION',
        retryable: false,
        message: 'Codex authentication is unavailable.',
      },
    },
    {
      mode: 'permission-failure',
      expected: {
        category: 'PERMISSION',
        retryable: false,
        message: 'Codex permission was denied.',
      },
    },
    {
      mode: 'model-failure',
      expected: {
        category: 'MODEL',
        retryable: false,
        message: 'The selected Codex model is unavailable.',
      },
    },
    {
      mode: 'process-failure',
      expected: {
        category: 'PROCESS',
        retryable: true,
        message: 'Codex failed (exit 23).',
      },
    },
  ])('classifies $mode without exposing child diagnostics', async ({
    mode,
    expected,
  }) => {
    const result = await createProvider(mode).summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    });

    expect(result).toEqual({ success: false, error: expected });
  });

  it('classifies timeout, cancellation, and spawn failure', async () => {
    const timedOut = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: 'hang',
      },
      tempDirectory: tempDir,
      timeoutMs: 20,
    });
    await expect(timedOut.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    })).resolves.toEqual({
      success: false,
      error: {
        category: 'TIMEOUT',
        retryable: true,
        message: 'Codex timed out.',
      },
    });

    const controller = new AbortController();
    const cancellation = createProvider('hang').summarize(
      {
        transcript: TRANSCRIPT_CANARY,
        template: AIPromptTemplate.MEETING,
      },
      controller.signal,
    );
    await vi.waitFor(() => {
      expect(
        fs.readdirSync(tempDir).some((name) =>
          name.startsWith('meeting-summarizer-codex-'),
        ),
      ).toBe(true);
    });
    controller.abort();
    await expect(cancellation).resolves.toEqual({
      success: false,
      error: {
        category: 'CANCELLED',
        retryable: true,
        message: 'Codex was cancelled.',
      },
    });

    const spawnFailure = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: path.join(tempDir, 'missing-codex'),
      tempDirectory: tempDir,
    });
    await expect(spawnFailure.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    })).resolves.toEqual({
      success: false,
      error: {
        category: 'PROCESS',
        retryable: false,
        message: 'Codex could not be started.',
      },
    });
  });

  it.each([
    {
      mode: 'overflow-auth',
      options: { stderrLimitBytes: 8 },
      expected: {
        category: 'PROCESS',
        retryable: true,
        message: 'Codex output exceeded the capture limit.',
      },
    },
    {
      mode: 'auth-permission-model',
      expected: {
        category: 'AUTHENTICATION',
        retryable: false,
        message: 'Codex authentication is unavailable.',
      },
    },
    {
      mode: 'permission-model',
      expected: {
        category: 'PERMISSION',
        retryable: false,
        message: 'Codex permission was denied.',
      },
    },
    {
      mode: 'model-process-empty',
      expected: {
        category: 'MODEL',
        retryable: false,
        message: 'The selected Codex model is unavailable.',
      },
    },
    {
      mode: 'process-empty',
      expected: {
        category: 'PROCESS',
        retryable: true,
        message: 'Codex failed (exit 23).',
      },
    },
  ])('applies failure precedence for $mode', async ({
    mode,
    options,
    expected,
  }) => {
    const provider = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: mode,
      },
      tempDirectory: tempDir,
      ...options,
    });

    await expect(provider.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    })).resolves.toEqual({ success: false, error: expected });
  });

  it('prioritizes cancellation over timeout and timeout over overflow', async () => {
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    const cancellation = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: 'hang',
      },
      tempDirectory: tempDir,
      timeoutMs: 0,
    });
    await expect(cancellation.summarize(
      {
        transcript: TRANSCRIPT_CANARY,
        template: AIPromptTemplate.MEETING,
      },
      alreadyCancelled.signal,
    )).resolves.toMatchObject({
      success: false,
      error: { category: 'CANCELLED' },
    });

    const outputWrittenPath = path.join(tempDir, 'output-written');
    const timeoutWithOversizedFile = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: 'file-overflow',
        FAKE_CODEX_OUTPUT_WRITTEN_PATH: outputWrittenPath,
      },
      tempDirectory: tempDir,
      timeoutMs: 2_000,
      finalMessageLimitBytes: 8,
      finalMessagePollIntervalMs: 5_000,
    });
    await expect(timeoutWithOversizedFile.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.MEETING,
    })).resolves.toMatchObject({
      success: false,
      error: { category: 'TIMEOUT' },
    });
    expect(fs.readFileSync(outputWrittenPath, 'utf8')).toBe('written');
  });

  it('redacts all sensitive inputs and child output from errors and logs', async () => {
    const credential = 'CREDENTIAL-CANARY';
    const stdout = 'STDOUT-CANARY';
    const stderr = 'STDERR-CANARY';
    const finalMessage = 'FINAL-MESSAGE-CANARY';
    const provider = new CodexProvider({
      model: MODEL_CANARY,
      executablePath: process.execPath,
      executableArgs: [fakeCodexPath],
      environment: {
        ...process.env,
        FAKE_CODEX_MODE: 'redaction-failure',
        CODEX_CREDENTIAL: credential,
        FAKE_CODEX_STDOUT_CANARY: stdout,
        FAKE_CODEX_STDERR_CANARY: stderr,
        FAKE_CODEX_FINAL_CANARY: finalMessage,
      },
      tempDirectory: tempDir,
    });

    const result = await provider.summarize({
      transcript: TRANSCRIPT_CANARY,
      template: AIPromptTemplate.TRAINING,
    });
    const observable = JSON.stringify([
      result,
      ...logs.flatMap((log) => log.mock.calls),
    ]);

    for (const canary of [
      credential,
      MODEL_CANARY,
      TRANSCRIPT_CANARY,
      SUMMARY_PROMPTS[AIPromptTemplate.TRAINING],
      stdout,
      stderr,
      finalMessage,
    ]) {
      expect(observable).not.toContain(canary);
    }
  });
});
