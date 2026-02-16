import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { apiService, JobStatus, configService } from '../services';
import { TranscriptionLanguage, SummaryTemplate } from '@meeting-summarizer/shared'; 

export async function syncCommand() {
  console.log('🔄 Initializing Sync Workflow...');

  // 1. Check Server Status
  const isOnline = await apiService.checkHealth();
  if (!isOnline) {
    console.error('❌ Server is OFFLINE. Please start the server and try again.');
    return;
  }

  // 2. Select File
  const recordingDir = configService.get('paths').output;
  const selectedFile = await selectRecording(recordingDir);
  
  if (!selectedFile) {
    console.log('No recording selected. Exiting.');
    return;
  }

  const filePath = path.join(recordingDir, selectedFile);

  // 3. Select Processing Options
  // We use 'input' for numbers to allow empty (undefined) values easily
  const options = await inquirer.prompt([
    {
      type: 'list',
      name: 'language',
      message: 'Select Audio Language (Whisper):',
      choices: [
        { name: 'Auto Detect 🤖', value: TranscriptionLanguage.AUTO },
        { name: 'English (US)', value: TranscriptionLanguage.ENGLISH },
        { name: 'Portuguese (BR)', value: TranscriptionLanguage.PORTUGUESE },
        { name: 'Spanish', value: TranscriptionLanguage.SPANISH },
      ],
      default: TranscriptionLanguage.AUTO
    },
    {
      type: 'input',
      name: 'minSpeakers',
      message: 'Min Speakers (Optional, press Enter to skip):',
      filter: (input) => input ? parseInt(input, 10) : undefined,
      validate: (input) => !input || !isNaN(parseInt(input)) || 'Please enter a number'
    },
    {
      type: 'input',
      name: 'maxSpeakers',
      message: 'Max Speakers (Optional, press Enter to skip):',
      filter: (input) => input ? parseInt(input, 10) : undefined,
      validate: (input) => !input || !isNaN(parseInt(input)) || 'Please enter a number'
    },
    {
      type: 'list',
      name: 'template',
      message: 'Select Summary Style (Gemini):',
      choices: [
        { name: 'Meeting Minutes 📝 (Action Items, Decisions)', value: SummaryTemplate.MEETING },
        { name: 'Training/Lecture 🎓 (Key Concepts, Q&A)', value: SummaryTemplate.TRAINING },
        { name: 'Brief Summary 📄 (TL;DR)', value: SummaryTemplate.SUMMARY },
      ],
      default: SummaryTemplate.MEETING
    }
  ]);

  try {
    // 4. Upload
    console.log(`\n📤 Uploading: ${selectedFile}`);
    console.log(`   Config: [Lang: ${options.language} | Speakers: ${options.minSpeakers || '?'} - ${options.maxSpeakers || '?'} | Tmpl: ${options.template}]`);
    
    const uploadResult = await apiService.uploadMeeting(filePath, {
      language: options.language,
      template: options.template,
      minSpeakers: options.minSpeakers,
      maxSpeakers: options.maxSpeakers
    });
    
    if (!uploadResult.success) {
      console.error(`❌ Upload failed: ${uploadResult.message}`);
      return;
    }

    console.log(`✅ Upload Complete. Job ID: ${uploadResult.jobId}`);

    // 5. Poll for Completion
    const completedJob = await pollForCompletion(uploadResult.jobId);

    if (completedJob) {
      await saveToObsidian(completedJob, selectedFile);
    }

  } catch (error: any) {
    console.error('❌ Sync Error:', error.message);
  }
}

// ... (Helper functions selectRecording, pollForCompletion, saveToObsidian remain unchanged)
async function selectRecording(dir: string): Promise<string | null> {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    // .filter(f => f.endsWith('.mkv'))
    .sort((a, b) => fs.statSync(path.join(dir, b)).mtime.getTime() - fs.statSync(path.join(dir, a)).mtime.getTime());
  if (files.length === 0) return null;
  const { file } = await inquirer.prompt([{ type: 'list', name: 'file', message: 'Select a meeting:', choices: files, pageSize: 10 }]);
  return file;
}

async function pollForCompletion(jobId: string): Promise<JobStatus | null> {
  console.log('\n⏳ Processing started. Please wait...');
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const job = await apiService.getJobStatus(jobId);
        process.stdout.write(`\r   Current Status: [ ${job.status} ] `);
        if (job.status === 'COMPLETED') {
          clearInterval(interval);
          console.log('\n\n✨ Processing Finished!');
          resolve(job);
        } else if (job.status === 'FAILED') {
          clearInterval(interval);
          console.error(`\n\n❌ Job Failed: ${job.error}`);
          resolve(null);
        }
      } catch (err) {}
    }, 2000);
  });
}

async function saveToObsidian(job: JobStatus, originalFilename: string) {
  const vaultPath = configService.get('paths').obsidianVault;
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    console.log(job.summary); return;
  }
  const baseName = path.parse(originalFilename).name;
  const fullPath = path.join(vaultPath, `${baseName}.md`);
  const fileContent = `---
tags: [meeting, transcript, ai-summary]
date: ${new Date().toISOString().split('T')[0]}
original_file: ${originalFilename}
---
# 📝 ${baseName.replace(/_/g, ' ')}

## 🧠 AI Executive Summary
${job.summary || '_No summary generated._'}

---
## 💬 Full Transcript
<details>
<summary>Click to expand full transcript</summary>

${job.transcript || '_No transcript available._'}
</details>
`;
  try { fs.writeFileSync(fullPath, fileContent, 'utf-8'); console.log(`\n📚 Saved to: ${fullPath}`); } 
  catch (err) { console.error('❌ Failed to write file:', err); }
}