import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * These tests verify that the setup wizard correctly maps
 * inquirer prompt answer names to the config service setter calls.
 * 
 * The critical bug was: the prompt used 'apikey' (lowercase k) but
 * the save code referenced 'answers.apiKey' (camelCase), so the
 * API key was never persisted — causing hasConfigured() to always
 * return false and triggering the setup wizard on every menu action.
 */

// Mock inquirer
vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn(),
    },
}));

// Mock configService
const mockGet = vi.fn();
const mockSet = vi.fn();

vi.mock('../../src/services/config', () => ({
    configService: {
        get: (...args: any[]) => mockGet(...args),
        set: (...args: any[]) => mockSet(...args),
        store: { path: '/mock/config/path' },
    },
}));

import inquirer from 'inquirer';
import { runSetup } from '../../src/services/setup';

describe('Setup: Config Save Round-Trip', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Default return values for configService.get()
        mockGet.mockImplementation((key: string) => {
            if (key === 'server') return { ip: '127.0.0.1', port: 3000, apiKey: '' };
            if (key === 'paths') return { output: '/recordings' };
            return {};
        });
    });

    it('should save the API key from the "apikey" prompt field', async () => {
        // Simulate user filling in the setup wizard
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({
            serverIp: '192.168.1.100',
            serverPort: 3000,
            apikey: 'my-secret-key',
            outputPath: '/my/recordings',
            obsidianVault: '',
        });

        await runSetup();

        // Verify server config was saved with the correct apiKey
        expect(mockSet).toHaveBeenCalledWith('server', {
            ip: '192.168.1.100',
            port: 3000,
            apiKey: 'my-secret-key',
        });
    });

    it('should save paths config correctly', async () => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({
            serverIp: '127.0.0.1',
            serverPort: 3000,
            apikey: 'test-key',
            outputPath: '/custom/output',
            obsidianVault: '/my/vault',
        });

        await runSetup();

        expect(mockSet).toHaveBeenCalledWith('paths', {
            output: '/custom/output',
            obsidianVault: '/my/vault',
        });
    });

    it('should set obsidianVault to undefined when empty string is provided', async () => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({
            serverIp: '127.0.0.1',
            serverPort: 3000,
            apikey: 'test-key',
            outputPath: '/output',
            obsidianVault: '',
        });

        await runSetup();

        expect(mockSet).toHaveBeenCalledWith('paths', {
            output: '/output',
            obsidianVault: undefined,
        });
    });

    it('should NOT save apiKey as undefined (the original bug)', async () => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce({
            serverIp: '127.0.0.1',
            serverPort: 3000,
            apikey: 'valid-key',
            outputPath: '/output',
            obsidianVault: '',
        });

        await runSetup();

        // The server config call should have a defined, non-empty apiKey
        const serverCall = mockSet.mock.calls.find(
            (call) => call[0] === 'server'
        );
        expect(serverCall).toBeDefined();
        expect(serverCall![1].apiKey).toBe('valid-key');
        expect(serverCall![1].apiKey).not.toBeUndefined();
    });
});
