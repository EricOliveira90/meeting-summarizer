import { spawn } from 'child_process';
import { AudioRecService, AudioRecEvent, configService, MeetingPicker, QUICK_START_VALUE } from '../services';
import { IMeetingService, Meeting, MeetingStatus } from '../domain';
import { GlobalKeyboardListener, IGlobalKeyEvent, IGlobalKeyDownMap } from 'node-global-key-listener';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

// ── Pure helpers (exported for testing) ──

/**
 * Sanitizes a title for use in filenames.
 * Replaces special characters with underscores and collapses consecutive underscores.
 */
export function sanitizeTitle(title: string): string {
    return title
        .replace(/[^a-z0-9_]/gi, '_')
        .replace(/_+/g, '_');
}

/**
 * Builds a recording filename: YYYY-MM-DD_HH-mm_Title.wav
 * Uses "recording" as placeholder when no title is provided.
 */
export function buildRecordingFilename(title: string | undefined, date: Date): string {
    const sanitized = title && title.trim()
        ? sanitizeTitle(title.trim())
        : 'recording';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}_${hours}-${minutes}_${sanitized}.wav`;
}

// ── Record Command ──

/**
 * Main Command: Orchestrates the recording workflow using audio-rec.
 * Supports two flows:
 * 1. Meeting picker flow: if pre-created meetings exist, show a picker
 * 2. On-the-fly flow: prompt for optional title, record, rename after
 * 
 * @param meetingService Optional meeting service for meeting picker integration
 */
export async function recordCommand(meetingService?: IMeetingService, preSelectedMeetingId?: string) {
    console.log('Initializing recording workflow...');

    const audioRecService = new AudioRecService(spawn);
    let title: string | undefined;
    let selectedMeeting: Meeting | undefined;
    let meetingPicker: MeetingPicker | undefined;

    // ── Phase 1: Determine title (pre-selected, meeting picker, or on-the-fly) ──

    if (meetingService) {
        meetingPicker = new MeetingPicker(meetingService);

        // If a meeting ID was pre-selected (e.g., from Create Meeting chain), skip the picker
        if (preSelectedMeetingId) {
            selectedMeeting = await meetingPicker.selectMeeting(preSelectedMeetingId);
            if (selectedMeeting) {
                title = selectedMeeting.title;
            }
        } else {
            const choices = await meetingPicker.getPickerChoices();

            // Only show picker if there are CREATED meetings (choices > 1 means meetings + quick start)
            const hasCreatedMeetings = choices.length > 1;

            if (hasCreatedMeetings) {
                const { selectedValue } = await inquirer.prompt([{
                    type: 'list',
                    name: 'selectedValue',
                    message: 'Select a meeting to record:',
                    choices: choices.map(c => ({ name: c.name, value: c.value })),
                }]);

                if (selectedValue !== QUICK_START_VALUE) {
                    // User selected a pre-created meeting
                    selectedMeeting = await meetingPicker.selectMeeting(selectedValue);
                    if (selectedMeeting) {
                        title = selectedMeeting.title;
                    }
                }
                // else: fall through to on-the-fly flow
            }
        }
    }

    // On-the-fly flow: prompt for optional title if no meeting was selected
    if (!selectedMeeting) {
        const { inputTitle } = await inquirer.prompt([{
            type: 'input',
            name: 'inputTitle',
            message: 'Enter a title or press Enter to skip:',
        }]);
        title = inputTitle || undefined;
    }

    // ── Phase 2: Build filename and start recording ──

    const recordingStartTime = new Date();
    const filename = buildRecordingFilename(title, recordingStartTime);
    const outputDir = configService.get('paths').output;
    const outputPath = path.join(outputDir, filename);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Read device config
    const audioRecConfig = configService.get('audioRec');

    // Start recording
    try {
        audioRecService.startRecording({
            outputPath,
            inputDeviceIndex: audioRecConfig.inputDeviceIndex,
            outputDeviceIndex: audioRecConfig.outputDeviceIndex,
        });

        // Listen for JSON events
        audioRecService.onEvent((event: AudioRecEvent) => {
            switch (event.type) {
                case 'started':
                    console.log(`⏺ Recording started: ${event.session_id}`);
                    console.log(`   File: ${event.file_path}`);
                    break;
                case 'audio_state':
                    console.log(`🔊 Audio: System=${event.loopback_has_audio ? 'ON' : 'OFF'}, Mic=${event.mic_has_audio ? 'ON' : 'OFF'}, Muted=${event.is_mic_muted ? 'YES' : 'NO'}`);
                    break;
                case 'muted':
                    console.log(event.is_muted ? '🔇 Microphone MUTED' : '🎤 Microphone UNMUTED');
                    break;
                case 'processing':
                    console.log(`⏳ Processing: ${event.message}`);
                    break;
                case 'completed':
                    console.log(`✅ Recording completed: ${event.file_path}`);
                    console.log(`   Size: ${event.file_size_mb} MB`);
                    break;
                case 'cancelled':
                    console.log(`⚠️ Recording cancelled: ${event.message}`);
                    break;
                case 'error':
                    console.error(`❌ Error: ${event.message}`);
                    break;
            }
        });

        console.log('Recording started! 🔴');
        console.log('Controls:\n  [M]     - Toggle Mute\n  [Enter] - Stop Recording');

        // Wait for hotkeys
        await handleHotkeys(audioRecService);

        // Stop recording
        audioRecService.stopRecording();
        console.log('Stopping recording...');

        // Wait a moment for the completed event to arrive
        await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
        console.error('❌ Error during recording session:', error);
        return;
    }

    // ── Phase 3: Post-recording ──

    // Mark meeting as RECORDED if one was selected
    if (selectedMeeting && meetingPicker) {
        await meetingPicker.markRecordingStopped(selectedMeeting.id);
    }

    // Prompt for title if it was skipped (on-the-fly flow only)
    const usedPlaceholder = !title || !title.trim();
    if (usedPlaceholder) {
        const { newTitle } = await inquirer.prompt([{
            type: 'input',
            name: 'newTitle',
            message: 'Enter a title for this recording (or press Enter to keep "recording"):',
        }]);

        if (newTitle && newTitle.trim()) {
            const newFilename = buildRecordingFilename(newTitle, recordingStartTime);
            const newPath = path.join(outputDir, newFilename);

            try {
                if (fs.existsSync(outputPath)) {
                    fs.renameSync(outputPath, newPath);
                    console.log(`\n✅ File renamed:`);
                    console.log(`   From: ${filename}`);
                    console.log(`   To:   ${newFilename}\n`);
                }
            } catch (err) {
                console.error('❌ Failed to rename recording:', err);
            }
        }
    }
}

/**
 * Listens for Global Hotkeys during recording.
 */
function handleHotkeys(audioRecService: AudioRecService): Promise<void> {
    return new Promise((resolve) => {
        const listener = new GlobalKeyboardListener();
        let isMuteKeyDown = false;

        // RAW MODE: Silence 'm' echoing
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
        }

        // DATA DRAIN: Actively discard input so it doesn't buffer
        const drainInput = (key: Buffer) => {
            if (key.toString() === '\u0003') {
                process.exit();
            }
        };
        process.stdin.on('data', drainInput);

        listener.addListener((e: IGlobalKeyEvent, _down: IGlobalKeyDownMap) => {
            // Toggle Mute
            if (e.name === 'M') {
                if (e.state === 'DOWN' && !isMuteKeyDown) {
                    isMuteKeyDown = true;
                    audioRecService.toggleMute();
                } else if (e.state === 'UP') {
                    isMuteKeyDown = false;
                }
            }

            // Stop Recording
            if (e.name === 'RETURN' && e.state === 'DOWN') {
                listener.kill();

                setTimeout(() => {
                    if (process.stdin.isTTY) {
                        process.stdin.off('data', drainInput);
                        process.stdin.setRawMode(false);
                    }
                    resolve();
                }, 300);
            }
        });
    });
}
