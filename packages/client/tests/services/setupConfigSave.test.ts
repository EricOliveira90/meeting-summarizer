import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

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
import {
    checkCodexReadiness,
    CodexProviderOptions,
} from '../../src/services/codexProvider';

const fakeCodexPath = path.resolve(
    __dirname,
    '..',
    'fixtures',
    'fake-codex.mjs',
);

describe('Setup: Config Save Round-Trip', () => {
    let tempDir: string;
    let protocolPath: string;

    beforeEach(() => {
        vi.clearAllMocks();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-setup-'));
        protocolPath = path.join(tempDir, 'protocol.jsonl');

        // Default return values for configService.get()
        mockGet.mockImplementation((key: string) => {
            if (key === 'server') return { ip: '127.0.0.1', port: 3000, apiKey: '' };
            if (key === 'paths') return { output: '/recordings' };
            if (key === 'codex') return { model: 'current-model' };
            return {};
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function readiness(mode = 'ready') {
        const options: CodexProviderOptions = {
            executablePath: process.execPath,
            executableArgs: [fakeCodexPath],
            environment: {
                ...process.env,
                FAKE_CODEX_MODE: mode,
                FAKE_CODEX_PROTOCOL_PATH: protocolPath,
            },
        };
        return (model: string) => checkCodexReadiness(model, options);
    }

    const ready = async () => ({
        executable: { status: 'ready' as const },
        authentication: { status: 'ready' as const },
        model: { status: 'ready' as const },
    });

    function promptAnswers(overrides: Record<string, unknown> = {}) {
        return {
            serverIp: '192.168.1.100',
            serverPort: 3000,
            apikey: 'my-secret-key',
            outputPath: '/my/recordings',
            obsidianVault: '',
            codexModel: 'gpt-5-codex',
            ...overrides,
        };
    }

    it.each([
        {
            mode: 'ready',
            model: 'gpt-5-codex',
            expected: {
                executable: { status: 'ready' },
                authentication: { status: 'ready' },
                model: { status: 'ready' },
            },
            expectedCalls: 3,
        },
        {
            mode: 'managed-credentials',
            model: 'gpt-5-codex',
            expected: {
                executable: { status: 'ready' },
                authentication: { status: 'ready' },
                model: { status: 'ready' },
            },
            expectedCalls: 3,
        },
        {
            mode: 'executable-failure',
            model: 'gpt-5-codex',
            expected: {
                executable: {
                    status: 'failed',
                    reason: 'Codex executable is unavailable.',
                },
                authentication: { status: 'not_checked' },
                model: { status: 'not_checked' },
            },
            expectedCalls: 1,
        },
        {
            mode: 'authentication-failure',
            model: 'gpt-5-codex',
            expected: {
                executable: { status: 'ready' },
                authentication: {
                    status: 'failed',
                    reason: 'Codex authentication is unavailable.',
                },
                model: { status: 'not_checked' },
            },
            expectedCalls: 2,
        },
        {
            mode: 'model-failure',
            model: 'missing-model',
            expected: {
                executable: { status: 'ready' },
                authentication: { status: 'ready' },
                model: {
                    status: 'failed',
                    reason: 'The selected Codex model is unavailable.',
                },
            },
            expectedCalls: 3,
        },
    ])('persists Codex and reports ordered readiness in $mode mode', async ({
        mode,
        model,
        expected,
        expectedCalls,
    }) => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce(
            promptAnswers({ codexModel: model }) as any,
        );
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        await runSetup({
            checkCodexReadiness: readiness(mode),
        });

        expect(mockSet).toHaveBeenCalledWith('defaultProvider', 'codex');
        expect(mockSet).toHaveBeenCalledWith('codex', { model });
        expect(log).toHaveBeenCalledWith(
            'Codex executable:',
            expected.executable.status,
            expected.executable.reason ?? '',
        );
        expect(log).toHaveBeenCalledWith(
            'Codex authentication:',
            expected.authentication.status,
            expected.authentication.reason ?? '',
        );
        expect(log).toHaveBeenCalledWith(
            'Codex model:',
            expected.model.status,
            expected.model.reason ?? '',
        );

        const calls = fs.existsSync(protocolPath)
            ? fs.readFileSync(protocolPath, 'utf8').trim().split('\n').map(JSON.parse)
            : [];
        expect(calls).toHaveLength(expectedCalls);
        expect(calls[0]).toEqual({ args: ['--version'], stdin: '' });
        if (expectedCalls >= 2) {
            expect(calls[1]).toEqual({ args: ['login', 'status'], stdin: '' });
        }
        if (expectedCalls === 3) {
            expect(calls[2].args).toEqual([
                'exec',
                '--ephemeral',
                '--ignore-user-config',
                '--ignore-rules',
                '--sandbox',
                'read-only',
                '-c',
                'approval_policy="never"',
                '--model',
                model,
                '--color',
                'never',
                '--output-last-message',
                expect.any(String),
                '-',
            ]);
            expect(calls[2].stdin).toBe('Reply with exactly READY.');
        }
        log.mockRestore();
    }, 15_000);

    it('should save the API key from the "apikey" prompt field', async () => {
        // Simulate user filling in the setup wizard
        vi.mocked(inquirer.prompt).mockResolvedValueOnce(promptAnswers() as any);

        await runSetup({ checkCodexReadiness: ready });

        // Verify server config was saved with the correct apiKey
        expect(mockSet).toHaveBeenCalledWith('server', {
            ip: '192.168.1.100',
            port: 3000,
            apiKey: 'my-secret-key',
        });
    });

    it('should save paths config correctly', async () => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce(promptAnswers({
            serverIp: '127.0.0.1',
            apikey: 'test-key',
            outputPath: '/custom/output',
            obsidianVault: '/my/vault',
        }) as any);

        await runSetup({ checkCodexReadiness: ready });

        expect(mockSet).toHaveBeenCalledWith('paths', {
            output: '/custom/output',
            obsidianVault: '/my/vault',
        });
    });

    it('should set obsidianVault to undefined when empty string is provided', async () => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce(promptAnswers({
            serverIp: '127.0.0.1',
            apikey: 'test-key',
            outputPath: '/output',
        }) as any);

        await runSetup({ checkCodexReadiness: ready });

        expect(mockSet).toHaveBeenCalledWith('paths', {
            output: '/output',
            obsidianVault: undefined,
        });
    });

    it('should NOT save apiKey as undefined (the original bug)', async () => {
        vi.mocked(inquirer.prompt).mockResolvedValueOnce(promptAnswers({
            serverIp: '127.0.0.1',
            apikey: 'valid-key',
            outputPath: '/output',
        }) as any);

        await runSetup({ checkCodexReadiness: ready });

        // The server config call should have a defined, non-empty apiKey
        const serverCall = mockSet.mock.calls.find(
            (call) => call[0] === 'server'
        );
        expect(serverCall).toBeDefined();
        expect(serverCall![1].apiKey).toBe('valid-key');
        expect(serverCall![1].apiKey).not.toBeUndefined();
    });
});
