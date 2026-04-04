import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from '../../src/services/syncManager';

// Test the runSync extracted function
vi.mock('../../src/services/syncManager', () => ({
    SyncManager: vi.fn(),
}));

import { runSync } from '../../src/commands/sync';

describe('Sync Refactor — runSync()', () => {
    it('should call syncManager.runFullSyncCycle()', async () => {
        const mockSyncManager = {
            runFullSyncCycle: vi.fn().mockResolvedValue(undefined),
        } as unknown as SyncManager;

        await runSync(mockSyncManager);

        expect(mockSyncManager.runFullSyncCycle).toHaveBeenCalledTimes(1);
    });

    it('should propagate errors from syncManager', async () => {
        const mockSyncManager = {
            runFullSyncCycle: vi.fn().mockRejectedValue(new Error('Sync failed')),
        } as unknown as SyncManager;

        await expect(runSync(mockSyncManager)).rejects.toThrow('Sync failed');
    });
});
