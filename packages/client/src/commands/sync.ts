import { Command } from 'commander';
import chalk from 'chalk';
import { SyncManager } from '../services/syncManager';
import { ApiService } from '../services/api';
import { LowDB } from '../services/db';
import { IngestionService } from '../services/ingestion';
import path from 'path';
import { NodeFileSystem } from '../utils/nodeFS';
import { NoteService } from '../services/note';
import { configService } from '../services';

/**
 * Extracted sync logic as a plain async function.
 * Accepts a pre-built SyncManager (from singleton factory or standalone).
 * Both mainMenuLoop (shared services) and Commander sync command (own services) call this.
 */
export async function runSync(syncManager: SyncManager): Promise<void> {
    await syncManager.runFullSyncCycle();
}

/**
 * Standalone Commander sync command.
 * Creates its own services (for `cli sync` usage outside the main menu).
 */
export const syncCommand = new Command('sync')
  .description('Run the magic batch process (Push Pending -> Update States -> Fetch Results)')
  .action(async () => {
    try {
      // 1. Instantiate the concrete implementations
      const apiService = new ApiService();
      const fs = new NodeFileSystem(path.resolve(__dirname, '..', '..'))
      const db = new LowDB(fs);
      const ingestion = new IngestionService(db);
      const noteService = new NoteService(fs, configService.get('obsidian'));

      // 2. Inject them into the Manager
      const syncManager = new SyncManager(apiService, db, noteService, ingestion, fs);

      // 3. Execute the batch cycle
      await runSync(syncManager);
      
    } catch (error) {
      console.error(chalk.red('\n❌ Sync process encountered a critical error:'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
