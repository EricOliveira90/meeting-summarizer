import { program } from 'commander';

program
  .name('meeting-cli')
  .description('CLI to record and summarize meetings')
  .version('1.0.0');

program.command('start')
  .description('Start the main menu')
  .action(() => {
    console.log("Welcome to Meeting Transcriber CLI");
    // Menu logic will go here
  });

program.parse();