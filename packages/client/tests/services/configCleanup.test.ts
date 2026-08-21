import { describe, it, expect } from 'vitest';
import { AppConfig, AudioRecConfig } from '../../src/domain/configs';

/**
 * These tests verify the config model changes:
 * - ObsConfig removed from AppConfig
 * - AudioRecConfig added with optional device indices
 * - AppConfig has 'audioRec' field instead of 'obs'
 */
describe('Config Model: AudioRecConfig', () => {
    it('should define AudioRecConfig with optional inputDeviceIndex and outputDeviceIndex', () => {
        const config: AudioRecConfig = {};
        expect(config.inputDeviceIndex).toBeUndefined();
        expect(config.outputDeviceIndex).toBeUndefined();
    });

    it('should accept numeric device indices', () => {
        const config: AudioRecConfig = {
            inputDeviceIndex: 0,
            outputDeviceIndex: 1,
        };
        expect(config.inputDeviceIndex).toBe(0);
        expect(config.outputDeviceIndex).toBe(1);
    });

    it('should have audioRec field on AppConfig instead of obs', () => {
        // This test verifies the shape of AppConfig at the type level.
        // If 'obs' still exists or 'audioRec' is missing, this won't compile.
        const config = {
            audioRec: { inputDeviceIndex: 0 },
            server: { ip: '127.0.0.1', port: 3000, apiKey: 'test' },
            paths: { output: '/tmp' },
            audio: {},
            obsidian: {
                vaultPath: '/vault',
                notesFolder: 'notes',
                availableTemplates: {} as any,
                activeTemplateName: 'Internal Meeting' as any,
            },
            defaultProvider: 'codex',
            codex: { model: 'gpt-5-codex' },
        } satisfies AppConfig;

        expect(config.audioRec).toBeDefined();
        expect(config.defaultProvider).toBe('codex');
        expect(config.codex.model).toBe('gpt-5-codex');
        expect((config as any).obs).toBeUndefined();
    });
});
