import { Command } from 'commander';
import chalk from 'chalk';
import { SyncManager } from '../services/syncManager';
import { ApiService } from '../services/api'; // Or import your singleton apiService
import { JobStateDB } from '../services/db';
import { ObsidianNoteService } from '../services/noteService';

export const syncCommand = new Command('sync')
  .description('Run the magic batch process (Push Pending -> Update States -> Fetch Results)')
  .action(async () => {
    try {
      // 1. Instantiate the concrete implementations
      const apiService = new ApiService();
      const db = new JobStateDB();
      const noteService = new ObsidianNoteService();

      // 2. Inject them into the Manager
      const syncManager = new SyncManager(apiService, db, noteService);

      // 3. Execute the batch cycle
      await syncManager.runFullSyncCycle();
      
    } catch (error) {
      console.error(chalk.red('\n❌ Sync process encountered a critical error:'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });