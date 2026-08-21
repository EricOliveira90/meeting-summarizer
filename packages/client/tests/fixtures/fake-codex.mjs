import fs from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CODEX_MODE ?? 'ready';
const protocolPath = process.env.FAKE_CODEX_PROTOCOL_PATH;

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
  if (mode === 'model-failure') {
    process.stderr.write('model "missing-model" is not supported\n');
    process.exitCode = 1;
  } else {
    const outputIndex = args.indexOf('--output-last-message');
    if (mode === 'summary-success') {
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
