import { program } from 'commander';
import inquirer from 'inquirer';
import path from 'path';
import { recordCommand } from './commands/record';
import { syncCommand, runSync } from './commands/sync';
import { createMeetingCommand } from './commands/createMeeting';
import { jobsHubCommand } from './commands/jobsHub';
import { getMenuChoices, MenuAction } from './commands/menu';
import { runSetup, runAudioSetup, configService } from './services';
import { ApiService } from './services/api';
import { LowDB } from './services/db';
import { IngestionService } from './services/ingestion';
import { MeetingService } from './services/meeting';
import { JobManager } from './services/jobManager';
import { NoteService } from './services/note';
import { SyncManager } from './services/syncManager';
import { NodeFileSystem } from './utils/nodeFS';

program
  .name('meeting-cli')
  .description('CLI to record and summarize meetings')
  .version('1.0.0');

/**
 * Ensures the app is configured before proceeding.
 * If not, triggers the setup wizard.
 */
async function ensureConfig(): Promise<void> {
  if (!configService.hasConfigured()) {
    console.log('⚠️ Configuration missing. Starting setup wizard...');
    await runSetup();
    console.log('\n✅ Setup complete!');
  }
}

/**
 * The main interactive loop of the application.
 * Menu items are in meeting lifecycle order.
 * 
 * Uses a singleton factory pattern: all shared services are instantiated once
 * at the top of the loop and passed into each command as function parameters.
 * This prevents multiple LowDB instances from reading/writing the same JSON file.
 */
async function mainMenuLoop() {
  // ── Singleton Service Factory ──
  // All services created once, shared across all commands in this session.
  const fs = new NodeFileSystem(path.resolve(__dirname, '..'));
  const db = new LowDB(fs);
  const apiService = new ApiService();
  const ingestion = new IngestionService(db);
  const meetingService = new MeetingService(db);
  const jobManager = new JobManager(db, fs);
  const noteService = new NoteService(fs, configService.get('obsidian'));
  const syncManager = new SyncManager(apiService, db, noteService, ingestion, fs);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    console.log(''); // Visual spacing
    
    const { action } = await inquirer.prompt<{ action: MenuAction }>([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: getMenuChoices()
      }
    ]);

    if (action === 'exit') {
      console.log('Goodbye! 👋');
      process.exit(0);
    }

    try {
      switch (action) {
        case 'create-meeting': {
          await ensureConfig();
          const result = await createMeetingCommand(meetingService);
          if (result.chainToRecord) {
            await recordCommand(meetingService, result.meetingId);
          }
          break;
        }
        case 'record':
          await ensureConfig();
          await recordCommand(meetingService);
          break;
        case 'jobs':
          await ensureConfig();
          await jobsHubCommand(jobManager, noteService, fs);
          break;
        case 'sync':
          await ensureConfig();
          await runSync(syncManager);
          break;
        case 'audio-setup':
          await ensureConfig();
          await runAudioSetup();
          break;
        case 'settings':
          await runSetup();
          break;
      }
    } catch (error) {
      // Ctrl+C graceful handling: inquirer throws error on Ctrl+C
      if (error && typeof error === 'object' && 'isTtyError' in error) {
        continue; // Silently return to menu
      }
      // Also handle generic "prompt was closed" errors
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('prompt') && (errMsg.includes('closed') || errMsg.includes('cancel'))) {
        continue; // Silently return to menu
      }
      console.error('❌ An unexpected error occurred:', error);
    }
  }
}

/**
 * Entry point for the default 'start' command.
 */
async function startApp() {
  console.clear();
  console.log("=== Meeting Transcriber CLI ===");
  
  await ensureConfig();
  await mainMenuLoop();
}

// --- CLI Command Definitions ---

program
  .command('start', { isDefault: true })
  .description('Start the interactive main menu')
  .action(startApp);

program
  .command('record')
  .description('Start recording a meeting immediately')
  .action(async () => {
    if (!configService.hasConfigured()) {
      console.error('❌ Error: CLI not configured. Run "npm start" to setup.');
      process.exit(1);
    }
    await recordCommand();
  });

program
  .command('sync')
  .description('Upload and process a recording')
  .action(async () => {
    await ensureConfig();
    // Standalone sync creates its own services via syncCommand
    await syncCommand.parseAsync(['node', 'cli', 'sync']);
  });

program
  .command('settings')
  .description('Run setup wizard')
  .action(runSetup);

program
  .command('audio')
  .description('Run audio device setup')
  .action(async () => {
      await ensureConfig();
      await runAudioSetup();
  });

// Initialize CLI
program.parse();
