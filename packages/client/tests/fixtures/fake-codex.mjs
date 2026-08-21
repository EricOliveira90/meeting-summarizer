import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? 'ready';
const protocolPath = process.env.FAKE_CODEX_PROTOCOL_PATH;
const pidPath = process.env.FAKE_CODEX_PID_PATH;

if (pidPath) {
  fs.writeFileSync(pidPath, String(process.pid));
}

let stdin = '';
for await (const chunk of process.stdin) {
  stdin += chunk.toString();
}

if (protocolPath) {
  fs.appendFileSync(protocolPath, `${JSON.stringify({ args, stdin })}\n`);
}

if (args[0] === '--version') {
  if (mode === 'executable-failure') {
    process.exitCode = 23;
  } else {
    process.stdout.write('codex-cli 1.2.3\n');
  }
} else if (args[0] === 'login' && args[1] === 'status') {
  if (mode === 'authentication-failure') {
    process.stderr.write('Not logged in\n');
    process.exitCode = 1;
  } else if (mode === 'managed-credentials') {
    process.stderr.write(
      'codex-wrapper: error: Login is not required. OpenAI Codex uses Bedrock via managed credentials.\n',
    );
    process.exitCode = 1;
  }
} else if (args[0] === 'exec') {
  if (mode === 'authentication-failure') {
    process.stderr.write('Not logged in\n');
    process.exitCode = 1;
  } else if (mode === 'permission-failure') {
    process.stderr.write('permission denied\n');
    process.exitCode = 1;
  } else if (mode === 'model-failure') {
    process.stderr.write('model "missing-model" is not supported\n');
    process.exitCode = 1;
  } else {
    const outputIndex = args.indexOf('--output-last-message');
    if (mode === 'auth-permission-model') {
      process.stderr.write(
        'Not logged in; permission denied; model "missing-model" is not supported\n',
      );
      process.exitCode = 23;
    } else if (mode === 'permission-model') {
      process.stderr.write(
        'permission denied; model "missing-model" is not supported\n',
      );
      process.exitCode = 23;
    } else if (mode === 'model-process-empty') {
      process.stderr.write('model "missing-model" is not supported\n');
      fs.writeFileSync(args[outputIndex + 1], ' \n ');
      process.exitCode = 23;
    } else if (mode === 'process-empty') {
      fs.writeFileSync(args[outputIndex + 1], ' \n ');
      process.exitCode = 23;
    } else if (mode === 'overflow-auth') {
      process.stderr.write(`Not logged in ${'x'.repeat(64)}`);
      setInterval(() => {}, 1_000);
    } else if (mode === 'redaction-failure') {
      process.stdout.write(process.env.FAKE_CODEX_STDOUT_CANARY);
      process.stderr.write(process.env.FAKE_CODEX_STDERR_CANARY);
      fs.writeFileSync(
        args[outputIndex + 1],
        process.env.FAKE_CODEX_FINAL_CANARY,
      );
      process.exitCode = 23;
    } else if (mode === 'stdout-overflow') {
      process.stdout.write('x'.repeat(64));
      setInterval(() => {}, 1_000);
    } else if (mode === 'stderr-overflow') {
      process.stderr.write('x'.repeat(64));
      setInterval(() => {}, 1_000);
    } else if (mode === 'file-overflow') {
      fs.writeFileSync(args[outputIndex + 1], 'x'.repeat(64));
      if (process.env.FAKE_CODEX_OUTPUT_WRITTEN_PATH) {
        fs.writeFileSync(process.env.FAKE_CODEX_OUTPUT_WRITTEN_PATH, 'written');
      }
      setInterval(() => {}, 1_000);
    } else if (mode === 'hang') {
      fs.writeFileSync(args[outputIndex + 1], 'SENSITIVE TEMP CONTENT');
      setInterval(() => {}, 1_000);
    } else if (mode === 'process-failure') {
      fs.writeFileSync(args[outputIndex + 1], 'SENSITIVE TEMP CONTENT');
      process.exitCode = 23;
    } else if (mode === 'summary-success') {
      process.stdout.write('STDOUT IS NOT THE SUMMARY');
      process.stderr.write('STDERR IS NOT THE SUMMARY');
      fs.writeFileSync(
        args[outputIndex + 1],
        '## Training Summary\n\n- Exact final message',
      );
    } else if (mode === 'normalized-output') {
      fs.writeFileSync(
        args[outputIndex + 1],
        ' \r\nArbitrary final text\r\nwith a second line\r\n ',
      );
    } else if (mode === 'empty-output') {
      fs.writeFileSync(args[outputIndex + 1], ' \r\n\t ');
    } else {
      fs.writeFileSync(args[outputIndex + 1], ' \r\nREADY\r\n ');
    }
  }
}
