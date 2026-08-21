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
});
