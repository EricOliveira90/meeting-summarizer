import inquirer from 'inquirer';
import { obsService, configService } from '.';

export async function runAudioSetup() {
  console.log('Connecting to OBS to fetch audio devices...');
  const connected = await obsService.connect();
  
  if (!connected) {
    console.error('❌ Could not connect to OBS. Please check your OBS WebSocket settings in config.');
    return;
  }

  try {
    const microphones = await obsService.getAvailableMicrophones();
    const speakers = await obsService.getAvailableAudioOutputs();

    if (microphones.length === 0 || speakers.length === 0) {
        console.warn('⚠️ Warning: Could not find audio devices. Is OBS running and are sources available?');
    }

    // Get current audio config using the new 'audio' key
    const currentAudio = configService.get('audio');

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'micId',
        message: 'Select Microphone to Record:',
        choices: microphones,
        default: currentAudio.micId
      },
      {
        type: 'list',
        name: 'systemId',
        message: 'Select System/Desktop Audio to Record:',
        choices: speakers,
        default: currentAudio.systemId
      }
    ]);

    // Save using the new 'audio' key and AudioConfig interface
    configService.set('audio', {
      micId: answers.micId,
      systemId: answers.systemId
    });

    console.log('Setting up OBS Scene "Meeting Recording"...');
    await obsService.setupScene(answers.micId, answers.systemId);
    
    console.log('✅ Audio configuration saved and OBS scene updated!');

  } catch (error) {
    console.error('❌ Error during audio setup:', error);
  } finally {
    await obsService.disconnect();
  }
}

// Allow running standalone
if (require.main === module) {
  runAudioSetup().catch(console.error);
}
