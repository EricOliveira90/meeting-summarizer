import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { AudioRecService } from '../../src/services/audioRec';

// ── Helpers ──

function createFakeProcess() {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.pid = 12345;
    proc.kill = vi.fn();
    return proc;
}

function createSpawnTracker() {
    const calls: { command: string; args: string[] }[] = [];
    const processes: any[] = [];

    const spawn = (command: string, args: string[]) => {
        calls.push({ command, args });
        const proc = createFakeProcess();
        processes.push(proc);
        return proc;
    };

    return { spawn, calls, processes };
}

// ── Tests ──

describe('AudioRecService — Device Enumeration & Status', () => {
    let tracker: ReturnType<typeof createSpawnTracker>;
    let service: AudioRecService;

    beforeEach(() => {
        tracker = createSpawnTracker();
        service = new AudioRecService(tracker.spawn);
    });

    describe('getDevices()', () => {
        it('should spawn audio-rec devices and parse input/output device arrays', async () => {
            const devicesPromise = service.getDevices();

            // Simulate audio-rec devices JSON output
            const devicesJson = JSON.stringify({
                type: 'devices',
                input_devices: [
                    { index: 0, name: 'Microphone (Blue Yeti)', is_default: true, sample_rate: 48000, channels: 2 },
                ],
                output_devices: [
                    { index: 0, name: 'Speakers (Realtek)', is_default: true, sample_rate: 48000, channels: 2 },
                    { index: 1, name: 'HDMI Audio (NVIDIA)', is_default: false, sample_rate: 48000, channels: 8 },
                ],
            });

            tracker.processes[0].stdout.emit('data', devicesJson + '\n');
            tracker.processes[0].emit('close', 0);

            const result = await devicesPromise;

            expect(tracker.calls[0].args).toContain('devices');
            expect(result.inputDevices).toHaveLength(1);
            expect(result.inputDevices[0].name).toBe('Microphone (Blue Yeti)');
            expect(result.inputDevices[0].isDefault).toBe(true);
            expect(result.outputDevices).toHaveLength(2);
            expect(result.outputDevices[1].name).toBe('HDMI Audio (NVIDIA)');
        });

        it('should return empty arrays when audio-rec devices fails', async () => {
            const devicesPromise = service.getDevices();

            tracker.processes[0].emit('close', 1);

            const result = await devicesPromise;

            expect(result.inputDevices).toEqual([]);
            expect(result.outputDevices).toEqual([]);
        });
    });

    describe('getStatus()', () => {
        it('should spawn audio-rec status and return session info when active', async () => {
            const statusPromise = service.getStatus();

            const statusJson = JSON.stringify({
                type: 'status',
                active: true,
                session_id: 'rec-20260329_120000',
                filename: 'recording.wav',
                elapsed: '2m 34s',
                format: 'wav',
                is_mic_muted: false,
            });

            tracker.processes[0].stdout.emit('data', statusJson + '\n');
            tracker.processes[0].emit('close', 0);

            const result = await statusPromise;

            expect(tracker.calls[0].args).toContain('status');
            expect(result).not.toBeNull();
            expect(result!.active).toBe(true);
            expect(result!.session_id).toBe('rec-20260329_120000');
        });

        it('should return null when no active recording session', async () => {
            const statusPromise = service.getStatus();

            const statusJson = JSON.stringify({
                type: 'status',
                active: false,
                message: 'No active recording session found',
            });

            tracker.processes[0].stdout.emit('data', statusJson + '\n');
            tracker.processes[0].emit('close', 0);

            const result = await statusPromise;

            expect(result).toBeNull();
        });

        it('should return null when audio-rec status fails', async () => {
            const statusPromise = service.getStatus();

            tracker.processes[0].emit('close', 1);

            const result = await statusPromise;

            expect(result).toBeNull();
        });
    });
});
