import { program } from 'commander';
import inquirer from 'inquirer';
import { recordCommand } from './commands/record';
import { runSetup } from './setup';
import { runAudioSetup } from './setup-audio';
import { configService } from './services/config';
import { syncCommand } from './commands/sync';

// Updated Type definitions
type MenuAction = 'record' | 'sync' | 'settings' | 'audio-setup' | 'exit';

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
        choices: [
          { name: 'Start Recording 🔴', value: 'record' },
          { name: 'Sync & Summarize 🧠', value: 'sync' },
          { name: 'Audio Setup 🎙️', value: 'audio-setup' },
          { name: 'Settings ⚙️', value: 'settings' },
          { name: 'Exit 🚪', value: 'exit' }
        ]
      }
    ]);

    if (action === 'exit') {
      console.log('Goodbye! 👋');
      process.exit(0);
    }

    try {
      switch (action) {
        case 'record':
          await ensureConfig();
          await recordCommand();
          break;
        case 'sync':
          await ensureConfig();
          await syncCommand();
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
    await syncCommand();
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
