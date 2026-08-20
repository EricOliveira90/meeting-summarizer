import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function smokeServer() {
  const serverPath = path.join(repoRoot, 'packages/server/dist/index.js');
  process.env.GEMINI_API_KEY ||= 'built-runtime-smoke-key';
  process.env.API_KEY ||= 'built-runtime-smoke-api-key';
  const { buildServer } = require(serverPath);
  const server = buildServer({ apiKey: process.env.API_KEY });

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
  } finally {
    await server.close();
  }
}

await smokeClient();
await smokeServer();
console.log('Built runtime smoke passed.');
