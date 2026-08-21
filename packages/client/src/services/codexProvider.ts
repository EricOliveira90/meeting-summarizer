import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexReadiness } from '../domain';

const MANAGED_CREDENTIAL_MESSAGE =
  'Login is not required. OpenAI Codex uses Bedrock via managed credentials.';
const WRAPPER_ERROR_PREFIX = 'codex-wrapper: error: ';

export interface CodexProviderOptions {
  executablePath?: string;
  executableArgs?: string[];
  environment?: NodeJS.ProcessEnv;
}

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  spawnFailed: boolean;
}

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
): Promise<ProcessResult> {
  return new Promise((resolve) => {
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
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once('error', () => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: null,
        stdout: '',
        stderr: '',
        spawnFailed: true,
      });
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        spawnFailed: false,
      });
    });

    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    } else {
      child.stdin?.end();
    }
  });
}

function notChecked() {
  return { status: 'not_checked' as const };
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
    );
    let output = '';
    try {
      output = await fs.readFile(outputPath, 'utf8');
    } catch {}

    if (probe.exitCode !== 0 || output.replace(/\r\n/g, '\n').trim() !== 'READY') {
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
