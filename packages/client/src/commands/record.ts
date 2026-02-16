import { obsService, configService } from '../services';
import { GlobalKeyboardListener, IGlobalKeyEvent, IGlobalKeyDownMap } from 'node-global-key-listener';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';

// Interfaces
interface NodeError extends Error {
  code?: string;
}

/**
 * Main Command: Orchestrates the recording workflow.
 */
export async function recordCommand() {
  console.log('Initializing recording workflow...');

  const connected = await obsService.connect();
  if (!connected) {
    console.error('❌ Could not connect to OBS. Please check settings and ensure OBS is running.');
    return;
  }

  try {
    // 1. Start Recording
    await obsService.startRecording();
    console.log('Recording started! 🔴');

    // NEW: Force Unmute to prevent accidental silent recordings
    await ensureMicIsLive();
    
    console.log('Controls:\n  [M]     - Toggle Mute\n  [Enter] - Stop Recording');

    // 2. Wait for User Input (Hotkeys)
    await handleHotkeys();

    // 3. Stop Recording
    await obsService.stopRecording();
    console.log('Recording stopped.');

  } catch (error) {
    console.error('❌ Error during recording session:', error);
  } finally {
    // Always disconnect to clean up resources
    await obsService.disconnect();
  }

  // 4. Post-Processing (Rename)
  await handleFileRenaming();
}

/**
 * Ensures the microphone is active (Unmuted) when recording starts.
 */
async function ensureMicIsLive() {
  // You might need to add getMuteStatus to your obsService first
  // Or simply use setInputMute if your obs-websocket-js version supports it
  try {
    // This forces the 'Mic/Aux' input to be unmuted (false)
    await obsService.setInputMute('Mic/Aux', false);
    console.log('🎤 Microphone initialized: LIVE');
  } catch (err) {
    console.warn('⚠️ Could not force unmute. Please check OBS manually.');
  }
}

/**
 * Listens for Global Hotkeys.
 * Actively drains stdin to prevent 'Enter' from skipping the next prompt.
 */
function handleHotkeys(): Promise<void> {
  return new Promise((resolve) => {
    const listener = new GlobalKeyboardListener();
    let isMuteKeyDown = false;

    // 1. RAW MODE: Silence 'm' echoing
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume(); // Ensure stream is flowing
    }

    // 2. DATA DRAIN: Actively discard input so it doesn't buffer
    const drainInput = (key: Buffer) => {
      // Allow force quit with Ctrl+C
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
          toggleMuteSafe().catch(console.error);
        } else if (e.state === 'UP') {
          isMuteKeyDown = false;
        }
      }

      // Stop Recording
      if (e.name === 'RETURN' && e.state === 'DOWN') {
        listener.kill();

        // 3. THE FIX: Drain for a moment, then clean up WITHOUT pausing
        setTimeout(() => {
          if (process.stdin.isTTY) {
            process.stdin.off('data', drainInput); // Stop draining
            process.stdin.setRawMode(false);       // Restore normal text input
            // REMOVED: process.stdin.pause(); <--- This was the culprit
          }
          resolve();
        }, 300);
      }
    });
  });
}

/**
 * Wrapper to toggle mute safely without crashing the listener.
 */
async function toggleMuteSafe() {
  try {
    const isMuted = await obsService.toggleMute('Mic/Aux');
    console.log(isMuted ? 'Microphone MUTED 🔇' : 'Microphone UNMUTED 🎤');
  } catch (err) {
    console.error('Error toggling mute:', err);
  }
}

/**
 * Handles the user prompt for the title and the file renaming logic.
 */
async function handleFileRenaming() {
  const outputDir = configService.get('paths').output;
  
  if (!outputDir || !fs.existsSync(outputDir)) {
    console.error(`❌ Recording directory not found: ${outputDir}`);
    return;
  }

  // Prompt for Title
  const { title } = await inquirer.prompt([{
    type: 'input',
    name: 'title',
    message: 'Enter Meeting Title:',
    validate: (input) => input.trim() !== '' ? true : 'Title is required'
  }]);

  const sanitizedTitle = title.trim().replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
  
  try {
    renameLatestRecording(outputDir, sanitizedTitle);
  } catch (err) {
    console.error('❌ Failed to rename recording:', err);
  }
}

/**
 * Finds the most recent MKV in the directory and renames it.
 * Includes retry logic for Windows file locking issues.
 */
function renameLatestRecording(dir: string, title: string) {
  // Find most recent MKV
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.mkv'))
    .map(f => ({ name: f, time: fs.statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);

  if (files.length === 0) {
    console.warn('⚠️ No MKV files found to rename.');
    return;
  }

  const recentFile = files[0].name;
  const oldPath = path.join(dir, recentFile);

  // Generate new filename: YYYY-MM-DD_HH-mm_Title.mkv
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const timeStr = `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  
  const newFilename = `${dateStr}_${timeStr}_${title}.mkv`;
  const newPath = path.join(dir, newFilename);

  // Retry loop for renaming (Wait for OBS to release lock)
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Small synchronous delay to allow file system release
      const stopUntil = Date.now() + 1000;
      while (Date.now() < stopUntil) { /* busy wait */ }

      fs.renameSync(oldPath, newPath);
      
      console.log('\n✅ File renamed successfully:');
      console.log(`From: ${recentFile}`);
      console.log(`To:   ${newFilename}\n`);
      return; 
      
    } catch (error) {
      const err = error as NodeError;
      if (err.code === 'EBUSY' && attempt < maxAttempts) {
        console.log(`File locked, retrying (${attempt}/${maxAttempts})...`);
      } else {
        throw err;
      }
    }
  }
}