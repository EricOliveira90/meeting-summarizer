import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { AudioRecService } from '../../src/services/audioRec';

// ── Helpers: Fake child process ──

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

describe('AudioRecService', () => {
    let tracker: ReturnType<typeof createSpawnTracker>;
    let service: AudioRecService;

    beforeEach(() => {
        tracker = createSpawnTracker();
        service = new AudioRecService(tracker.spawn);
    });

    describe('startRecording()', () => {
        it('should spawn audio-rec record with output path, format=wav, quality=professional', () => {
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });

            expect(tracker.calls).toHaveLength(1);
            const { command, args } = tracker.calls[0];
            expect(command).toBe('audio-rec');
            expect(args).toContain('record');
            expect(args).toContain('-o');
            expect(args).toContain('C:\\recordings\\meeting.wav');
            expect(args).toContain('-f');
            expect(args).toContain('wav');
            expect(args).toContain('-q');
            expect(args).toContain('professional');
        });

        it('should pass device index flags when inputDeviceIndex and outputDeviceIndex are provided', () => {
            service.startRecording({
                outputPath: 'C:\\recordings\\meeting.wav',
                inputDeviceIndex: 1,
                outputDeviceIndex: 2,
            });

            const { args } = tracker.calls[0];
            expect(args).toContain('-id');
            expect(args).toContain('1');
            expect(args).toContain('-od');
            expect(args).toContain('2');
        });

        it('should omit device flags when no device indices are provided', () => {
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });

            const { args } = tracker.calls[0];
            expect(args).not.toContain('-id');
            expect(args).not.toContain('-od');
        });

        it('should pass --mic-muted flag when micMuted is true', () => {
            service.startRecording({
                outputPath: 'C:\\recordings\\meeting.wav',
                micMuted: true,
            });

            const { args } = tracker.calls[0];
            expect(args).toContain('--mic-muted');
        });

        it('should omit --mic-muted flag when micMuted is false or undefined', () => {
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });

            const { args } = tracker.calls[0];
            expect(args).not.toContain('--mic-muted');
        });
    });

    describe('stopRecording()', () => {
        it('should spawn audio-rec stop as a separate process', () => {
            service.stopRecording();

            expect(tracker.calls).toHaveLength(1);
            const { command, args } = tracker.calls[0];
            expect(command).toBe('audio-rec');
            expect(args).toContain('stop');
        });

        it('should pass session ID when provided', () => {
            service.stopRecording('rec-20260320_114500');

            const { args } = tracker.calls[0];
            expect(args).toContain('rec-20260320_114500');
        });
    });

    describe('toggleMute()', () => {
        it('should spawn audio-rec mute as a separate process', () => {
            service.toggleMute();

            expect(tracker.calls).toHaveLength(1);
            const { command, args } = tracker.calls[0];
            expect(command).toBe('audio-rec');
            expect(args).toContain('mute');
        });

        it('should pass session ID when provided', () => {
            service.toggleMute('rec-20260320_114500');

            const { args } = tracker.calls[0];
            expect(args).toContain('rec-20260320_114500');
        });
    });

    describe('JSON event parsing', () => {
        it('should parse a "started" event from stdout', async () => {
            const events: any[] = [];
            const proc = service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            // Simulate audio-rec emitting a started event
            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'started',
                session_id: 'rec-123',
                file_path: 'C:\\recordings\\meeting.wav',
                duration: -1,
                format: 'wav',
                quality: 'Professional (48kHz Stereo)',
                mic_muted: false,
                trim_silence: true,
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('started');
            expect(events[0].session_id).toBe('rec-123');
        });

        it('should parse an "audio_state" event from stdout', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'audio_state',
                session_id: 'rec-123',
                loopback_has_audio: true,
                mic_has_audio: false,
                is_mic_muted: false,
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('audio_state');
            expect(events[0].loopback_has_audio).toBe(true);
        });

        it('should parse a "muted" event from stdout', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'muted',
                session_id: 'rec-123',
                is_muted: true,
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('muted');
            expect(events[0].is_muted).toBe(true);
        });

        it('should parse a "processing" event from stdout', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'processing',
                session_id: 'rec-123',
                message: 'Trimming silence',
                elapsed_secs: 30,
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('processing');
            expect(events[0].message).toBe('Trimming silence');
        });

        it('should parse a "completed" event from stdout', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'completed',
                session_id: 'rec-123',
                file_path: 'C:\\recordings\\meeting.wav',
                filename: 'meeting.wav',
                file_size_mb: '2.34',
                format: 'wav',
                duration_secs: -1,
                message: 'Recording completed successfully',
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('completed');
            expect(events[0].file_size_mb).toBe('2.34');
        });

        it('should parse a "cancelled" event from stdout', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'cancelled',
                session_id: 'rec-123',
                message: 'Recording cancelled by user',
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('cancelled');
        });

        it('should parse an "error" event from stdout', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].stdout.emit('data', JSON.stringify({
                type: 'error',
                message: 'FFmpeg is not installed or not found in PATH',
            }) + '\n');

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('error');
            expect(events[0].message).toBe('FFmpeg is not installed or not found in PATH');
        });

        it('should handle multiple JSON events in a single data chunk', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            const chunk =
                JSON.stringify({ type: 'started', session_id: 'rec-123' }) + '\n' +
                JSON.stringify({ type: 'audio_state', session_id: 'rec-123', loopback_has_audio: true }) + '\n';

            tracker.processes[0].stdout.emit('data', chunk);

            expect(events).toHaveLength(2);
            expect(events[0].type).toBe('started');
            expect(events[1].type).toBe('audio_state');
        });

        it('should skip malformed JSON lines without crashing', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            const chunk =
                'not valid json\n' +
                JSON.stringify({ type: 'started', session_id: 'rec-123' }) + '\n';

            tracker.processes[0].stdout.emit('data', chunk);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('started');
        });
    });

    describe('error handling', () => {
        it('should emit an error event when the process exits with a non-zero code', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].emit('close', 1);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('error');
            expect(events[0].message).toContain('exited with code 1');
        });

        it('should not emit an error event when the process exits with code 0', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            tracker.processes[0].emit('close', 0);

            expect(events).toHaveLength(0);
        });

        it('should emit an error event when the process emits an error (e.g., tool not found)', () => {
            const events: any[] = [];
            service.startRecording({ outputPath: 'C:\\recordings\\meeting.wav' });
            service.onEvent((event) => events.push(event));

            const err = new Error('spawn audio-rec ENOENT') as any;
            err.code = 'ENOENT';
            tracker.processes[0].emit('error', err);

            expect(events).toHaveLength(1);
            expect(events[0].type).toBe('error');
            expect(events[0].message).toContain('audio-rec');
        });
    });
});
