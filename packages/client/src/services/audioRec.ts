import { ChildProcess } from 'child_process';

// ── Types ──

export interface StartRecordingOptions {
    outputPath: string;
    inputDeviceIndex?: number;
    outputDeviceIndex?: number;
    micMuted?: boolean;
}

export type AudioRecEventType = 'started' | 'audio_state' | 'muted' | 'processing' | 'completed' | 'cancelled' | 'error';

export interface AudioRecEvent {
    type: AudioRecEventType;
    [key: string]: any;
}

export interface AudioDevice {
    index: number;
    name: string;
    isDefault: boolean;
    sampleRate: number;
    channels: number;
}

export interface DevicesResult {
    inputDevices: AudioDevice[];
    outputDevices: AudioDevice[];
}

export interface StatusResult {
    active: boolean;
    session_id?: string;
    filename?: string;
    elapsed?: string;
    format?: string;
    is_mic_muted?: boolean;
    [key: string]: any;
}

export type EventCallback = (event: AudioRecEvent) => void;
export type SpawnFn = (command: string, args: string[]) => ChildProcess;

// ── Service ──

export class AudioRecService {
    private recordingProcess: ChildProcess | null = null;
    private eventListeners: EventCallback[] = [];
    private stdoutBuffer: string = '';

    constructor(private spawn: SpawnFn) {}

    /**
     * Register a callback for JSON events from audio-rec stdout.
     */
    public onEvent(callback: EventCallback): void {
        this.eventListeners.push(callback);
    }

    /**
     * Spawns `audio-rec record` with the given options.
     * Attaches stdout/stderr/close/error listeners for JSON event parsing.
     */
    public startRecording(options: StartRecordingOptions): ChildProcess {
        const args = [
            'record',
            '-o', options.outputPath,
            '-f', 'wav',
            '-q', 'professional',
        ];

        if (options.inputDeviceIndex !== undefined) {
            args.push('-id', String(options.inputDeviceIndex));
        }

        if (options.outputDeviceIndex !== undefined) {
            args.push('-od', String(options.outputDeviceIndex));
        }

        if (options.micMuted) {
            args.push('--mic-muted');
        }

        const proc = this.spawn('audio-rec', args);
        this.recordingProcess = proc;
        this.stdoutBuffer = '';

        // Parse JSON events from stdout line-by-line
        proc.stdout?.on('data', (data: Buffer | string) => {
            this.stdoutBuffer += data.toString();
            this.processBuffer();
        });

        // Handle process exit with non-zero code
        proc.on('close', (code: number | null) => {
            if (code !== null && code !== 0) {
                this.emitEvent({ type: 'error', message: `audio-rec exited with code ${code}` });
            }
            this.recordingProcess = null;
        });

        // Handle spawn errors (e.g., ENOENT when tool not found)
        proc.on('error', (err: Error) => {
            this.emitEvent({
                type: 'error',
                message: `audio-rec could not be started: ${err.message}`,
            });
            this.recordingProcess = null;
        });

        return proc;
    }

    /**
     * Spawns `audio-rec stop` to stop the active recording.
     */
    public stopRecording(sessionId?: string): ChildProcess {
        const args = ['stop'];
        if (sessionId) {
            args.push(sessionId);
        }
        return this.spawn('audio-rec', args);
    }

    /**
     * Spawns `audio-rec mute` to toggle microphone mute.
     */
    public toggleMute(sessionId?: string): ChildProcess {
        const args = ['mute'];
        if (sessionId) {
            args.push(sessionId);
        }
        return this.spawn('audio-rec', args);
    }

    /**
     * Spawns `audio-rec devices` and parses the JSON output into typed device arrays.
     */
    public getDevices(): Promise<DevicesResult> {
        return this.runCommand<DevicesResult>('devices', (parsed) => {
            if (parsed?.type === 'devices') {
                return {
                    inputDevices: (parsed.input_devices || []).map(this.mapDevice),
                    outputDevices: (parsed.output_devices || []).map(this.mapDevice),
                };
            }
            return null;
        }, { inputDevices: [], outputDevices: [] });
    }

    /**
     * Spawns `audio-rec status` and returns session info or null.
     */
    public getStatus(): Promise<StatusResult | null> {
        return this.runCommand<StatusResult | null>('status', (parsed) => {
            if (parsed?.type === 'status') {
                if (parsed.active === false) return null;
                return parsed as StatusResult;
            }
            return undefined; // not the right line, keep looking
        }, null);
    }

    // ── Private helpers ──

    private mapDevice(raw: any): AudioDevice {
        return {
            index: raw.index,
            name: raw.name,
            isDefault: raw.is_default,
            sampleRate: raw.sample_rate,
            channels: raw.channels,
        };
    }

    /**
     * Generic helper: spawns a one-shot audio-rec command, collects stdout,
     * parses JSON lines, and resolves with the first matching result.
     */
    private runCommand<T>(
        command: string,
        parser: (parsed: any) => T | null | undefined,
        fallback: T,
    ): Promise<T> {
        return new Promise<T>((resolve) => {
            const proc = this.spawn('audio-rec', [command]);
            let buffer = '';
            let resolved = false;

            proc.stdout?.on('data', (data: Buffer | string) => {
                buffer += data.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const parsed = JSON.parse(trimmed);
                        const result = parser(parsed);
                        if (result !== undefined) {
                            resolved = true;
                            resolve(result as T);
                            return;
                        }
                    } catch {
                        // skip malformed
                    }
                }
            });

            proc.on('close', () => {
                if (!resolved) resolve(fallback);
            });

            proc.on('error', () => {
                if (!resolved) resolve(fallback);
            });
        });
    }


    private processBuffer(): void {
        const lines = this.stdoutBuffer.split('\n');
        // Keep the last incomplete line in the buffer
        this.stdoutBuffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            try {
                const event = JSON.parse(trimmed) as AudioRecEvent;
                this.emitEvent(event);
            } catch {
                // Skip malformed JSON lines
            }
        }
    }

    private emitEvent(event: AudioRecEvent): void {
        for (const listener of this.eventListeners) {
            listener(event);
        }
    }
}
