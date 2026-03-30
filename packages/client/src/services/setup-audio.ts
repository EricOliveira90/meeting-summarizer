import { spawn } from 'child_process';
import inquirer from 'inquirer';
import { AudioRecService, configService } from '.';

export async function runAudioSetup() {
  console.log('Fetching audio devices via audio-rec...');
  
  const audioRecService = new AudioRecService(spawn);

  try {
    const { inputDevices, outputDevices } = await audioRecService.getDevices();

    if (inputDevices.length === 0 && outputDevices.length === 0) {
      console.warn('⚠️ No audio devices found. Is audio-rec installed and in PATH?');
      return;
    }

    console.log('⚠️ Note: Device indices may change if devices are plugged/unplugged.');

    // Get current audio-rec config
    const currentConfig = configService.get('audioRec');

    const inputChoices = inputDevices.map(d => ({
      name: `${d.name} (index: ${d.index}, ${d.sampleRate}Hz)${d.isDefault ? ' [DEFAULT]' : ''}`,
      value: d.index,
    }));

    const outputChoices = outputDevices.map(d => ({
      name: `${d.name} (index: ${d.index}, ${d.sampleRate}Hz)${d.isDefault ? ' [DEFAULT]' : ''}`,
      value: d.index,
    }));

    // Add "Use system default" option
    inputChoices.unshift({ name: '🔧 Use system default', value: -1 });
    outputChoices.unshift({ name: '🔧 Use system default', value: -1 });

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'inputDeviceIndex',
        message: 'Select Microphone (Input Device):',
        choices: inputChoices,
        default: currentConfig.inputDeviceIndex ?? -1,
      },
      {
        type: 'list',
        name: 'outputDeviceIndex',
        message: 'Select System Audio (Output Device):',
        choices: outputChoices,
        default: currentConfig.outputDeviceIndex ?? -1,
      },
    ]);

    // Save config — use undefined for "system default" (-1)
    configService.set('audioRec', {
      inputDeviceIndex: answers.inputDeviceIndex === -1 ? undefined : answers.inputDeviceIndex,
      outputDeviceIndex: answers.outputDeviceIndex === -1 ? undefined : answers.outputDeviceIndex,
    });

    console.log('✅ Audio configuration saved!');

  } catch (error) {
    console.error('❌ Error during audio setup:', error);
  }
}

// Allow running standalone
if (require.main === module) {
  runAudioSetup().catch(console.error);
}
