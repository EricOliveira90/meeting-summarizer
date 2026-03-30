import { program } from 'commander';
import inquirer from 'inquirer';
import { recordCommand } from './commands/record';
import { syncCommand } from './commands/sync';
import { getMenuChoices, MenuAction } from './commands/menu';
import { runSetup, runAudioSetup, configService } from './services';

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
 * Placeholder for Create Meeting command.
 * Prompts for meeting details and persists via MeetingService.
 */
async function createMeetingCommand(): Promise<void> {
  console.log('📋 Create Meeting flow (to be wired with full UI prompts)');
  // This will be wired to MeetingService.create() with inquirer prompts
}

/**
 * Placeholder for Jobs hub command.
 * Shows job list and detail sub-menu.
 */
async function jobsCommand(): Promise<void> {
  console.log('📊 Jobs hub (to be wired with full UI)');
  // This will be wired to JobManager with inquirer sub-menu
}

/**
 * Runs the sync command action (extracted from Commander).
 */
async function runSyncAction(): Promise<void> {
  // Trigger the sync command's action handler
  await syncCommand.parseAsync(['node', 'cli', 'sync']);
}

/**
 * The main interactive loop of the application.
 * Menu items are in meeting lifecycle order.
 */
async function mainMenuLoop() {
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
        case 'create-meeting':
          await ensureConfig();
          await createMeetingCommand();
          break;
        case 'record':
          await ensureConfig();
          await recordCommand();
          break;
        case 'jobs':
          await ensureConfig();
          await jobsCommand();
          break;
        case 'sync':
          await ensureConfig();
          await runSyncAction();
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
    await runSyncAction();
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
