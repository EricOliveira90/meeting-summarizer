import { Command } from 'commander';
import chalk from 'chalk';
import { SyncManager } from '../services/syncManager';
import { ApiService } from '../services/api'; // Or import your singleton apiService
import { LowDB } from '../services/db';
import { IngestionService } from '../services/ingestion';
import path from 'path';
import { NodeFileSystem } from '../utils/nodeFS';
import { NoteService } from '../services/note';
import { configService } from '../services';

export const syncCommand = new Command('sync')
  .description('Run the magic batch process (Push Pending -> Update States -> Fetch Results)')
  .action(async () => {
    try {
      // 1. Instantiate the concrete implementations
      const apiService = new ApiService();
      const fs = new NodeFileSystem(path.resolve(__dirname, '..', '..'))
      const db = new LowDB(fs);
      const ingestion = new IngestionService(db);
      const noteService = new NoteService(fs, );

      // 2. Inject them into the Manager
      const syncManager = new SyncManager(apiService, db, noteService, ingestion, fs);

      // 3. Execute the batch cycle
      await syncManager.runFullSyncCycle();
      
    } catch (error) {
      console.error(chalk.red('\n❌ Sync process encountered a critical error:'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });