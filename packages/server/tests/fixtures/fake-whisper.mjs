import fs from 'node:fs';

const argv = process.argv.slice(2);
const outputIndex = argv.indexOf('--output_file');
const outputPath = outputIndex === -1 ? undefined : argv[outputIndex + 1];
const token = process.env.HUGGING_FACE_TOKEN;
const transcriptCanary = process.env.FAKE_WHISPER_TRANSCRIPT_CANARY;

fs.writeFileSync(
  process.env.FAKE_WHISPER_PROTOCOL_PATH,
  JSON.stringify({ argv, token }),
  'utf8',
);

process.stdout.write(`stdout:${token}:${transcriptCanary}\n`);
process.stderr.write(`stderr:${token}:${transcriptCanary}\n`);

if (process.env.FAKE_WHISPER_MODE === 'fail') {
  process.exitCode = 23;
} else if (!outputPath) {
  process.exitCode = 24;
} else {
  fs.writeFileSync(outputPath, transcriptCanary, 'utf8');
}
