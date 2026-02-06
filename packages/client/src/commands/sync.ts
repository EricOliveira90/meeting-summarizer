import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { apiService, JobStatus } from '../services/api';
import { configService } from '../services/config';
import { TranscriptionLanguage, SummaryTemplate } from '@shared'; 

/**
 * Main Sync Command
 * 1. Checks Server Health
 * 2. Selects a Recording
 * 3. Selects Processing Options (Language & Template)
 * 4. Uploads & Polls
 * 5. Saves to Obsidian
 */
export async function syncCommand() {
  console.log('🔄 Initializing Sync Workflow...');

  // 1. Check Server Status
  const isOnline = await apiService.checkHealth();
  if (!isOnline) {
    console.error('❌ Server is OFFLINE. Please start the server and try again.');
    return;
  }

  // 2. Select File to Process
  const recordingDir = configService.get('paths').output;
  const selectedFile = await selectRecording(recordingDir);
  
  if (!selectedFile) {
    console.log('No recording selected. Exiting.');
    return;
  }

  const filePath = path.join(recordingDir, selectedFile);

  // 3. Select Processing Options
  const options = await inquirer.prompt([
    {
      type: 'list',
      name: 'language',
      message: 'Select Audio Language (Whisper):',
      choices: [
        { name: 'Auto Detect 🤖', value: TranscriptionLanguage.AUTO },
        { name: 'English (US) 🇺🇸', value: TranscriptionLanguage.ENGLISH },
        { name: 'Portuguese (BR) 🇧🇷', value: TranscriptionLanguage.PORTUGUESE },
        { name: 'Spanish 🇪🇸', value: TranscriptionLanguage.SPANISH },
      ],
      default: TranscriptionLanguage.AUTO
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
    
    // Updated to pass the options object
    const uploadResult = await apiService.uploadMeeting(filePath, {
      language: options.language,
      template: options.template
    });
    
    if (!uploadResult.success) {
      console.error(`❌ Upload failed: ${uploadResult.message}`);
      return;
    }

    console.log(`✅ Upload Complete. Job ID: ${uploadResult.jobId}`);

    // 5. Poll for Completion
    const completedJob = await pollForCompletion(uploadResult.jobId);

    if (completedJob) {
      // 6. Generate Markdown in Obsidian
      await saveToObsidian(completedJob, selectedFile);
    }

  } catch (error: any) {
    console.error('❌ Sync Error:', error.message);
  }
}

/**
 * Helper: Lists MKV files and asks user to pick one.
 */
async function selectRecording(dir: string): Promise<string | null> {
  if (!fs.existsSync(dir)) {
    console.error(`❌ Recording directory not found: ${dir}`);
    return null;
  }

  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.mkv'))
    .sort((a, b) => {
      // Sort by newest modified time
      return fs.statSync(path.join(dir, b)).mtime.getTime() - 
             fs.statSync(path.join(dir, a)).mtime.getTime();
    });

  if (files.length === 0) {
    console.log('⚠️ No recordings found.');
    return null;
  }

  const { file } = await inquirer.prompt([{
    type: 'list',
    name: 'file',
    message: 'Select a meeting to process:',
    choices: files,
    pageSize: 10
  }]);

  return file;
}

/**
 * Helper: Polls the server every 2 seconds until job is done.
 */
async function pollForCompletion(jobId: string): Promise<JobStatus | null> {
  console.log('\n⏳ Processing started. Please wait...');
  
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const job = await apiService.getJobStatus(jobId);
        
        // Clear line and print status
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
      } catch (err) {
        // Ignore transient network errors during polling
      }
    }, 2000);
  });
}

/**
 * Helper: Formats the data and writes to Obsidian Vault.
 */
async function saveToObsidian(job: JobStatus, originalFilename: string) {
  const vaultPath = configService.get('paths').obsidianVault;
  
  if (!vaultPath || !fs.existsSync(vaultPath)) {
    console.warn('\n⚠️ Obsidian Vault path not configured or invalid.');
    console.log('Dumping result to console instead:\n');
    console.log(job.summary);
    return;
  }

  // Generate Filename (matches input filename but with .md)
  const baseName = path.parse(originalFilename).name;
  const mdFilename = `${baseName}.md`;
  const fullPath = path.join(vaultPath, mdFilename);

  // Markdown Template
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

  try {
    fs.writeFileSync(fullPath, fileContent, 'utf-8');
    console.log(`\n📚 Saved to Obsidian: ${mdFilename}`);
    console.log(`   Path: ${fullPath}`);
  } catch (err) {
    console.error('❌ Failed to write Obsidian file:', err);
  }
}