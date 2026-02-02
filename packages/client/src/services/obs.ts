import OBSWebSocket from 'obs-websocket-js';
import { configService } from './config';

// Constants to avoid magic strings
const INPUT_KINDS = {
  MIC: 'wasapi_input_capture',
  DESKTOP: 'wasapi_output_capture'
} as const;

interface DeviceOption {
  name: string;
  value: string;
}

export class OBSService {
  private obs: OBSWebSocket;
  private isConnected: boolean = false;

  constructor() {
    this.obs = new OBSWebSocket();
  }

  async connect(): Promise<boolean> {
    if (this.isConnected) return true;

    const config = configService.get('obs');
    const url = `ws://${config.ip}:${config.port}`;

    try {
      await this.obs.connect(url, config.password);
      this.isConnected = true;
      console.log('✅ Connected to OBS');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to OBS:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    await this.obs.disconnect();
    this.isConnected = false;
    console.log('Disconnected from OBS');
  }

  /**
   * Device Discovery
   */
  async getAvailableMicrophones(): Promise<DeviceOption[]> {
    return this.getDeviceList(INPUT_KINDS.MIC);
  }

  async getAvailableAudioOutputs(): Promise<DeviceOption[]> {
    return this.getDeviceList(INPUT_KINDS.DESKTOP);
  }

  /**
   * Scene & Source Management
   */
  async setupScene(micDeviceId: string, desktopDeviceId: string, sceneName: string = 'Meeting Recording') {
    this.assertConnected();

    // 1. Ensure Scene Exists
    const { scenes } = await this.obs.call('GetSceneList');
    if (!scenes.some(s => s.sceneName === sceneName)) {
      await this.obs.call('CreateScene', { sceneName });
      console.log(`Created scene: "${sceneName}"`);
    }

    // 2. Setup Mic Input
    await this.ensureInputInScene(
      'Meeting Mic',
      INPUT_KINDS.MIC,
      { device_id: micDeviceId },
      sceneName
    );

    // 3. Setup Desktop Audio Input
    await this.ensureInputInScene(
      'Meeting Output',
      INPUT_KINDS.DESKTOP,
      { device_id: desktopDeviceId },
      sceneName
    );
  }

  /**
   * Recording Controls
   */
  async startRecording(): Promise<void> {
    this.assertConnected();
    await this.obs.call('StartRecord');
    console.log('⏺ Recording started');
  }

  async stopRecording(): Promise<string> {
    this.assertConnected();
    const { outputPath } = await this.obs.call('StopRecord');
    console.log(`⏹ Recording stopped. Saved to: ${outputPath}`);
    return outputPath;
  }

  async toggleMute(inputName: string): Promise<boolean> {
    this.assertConnected();
    try {
      const { inputMuted } = await this.obs.call('GetInputMute', { inputName });
      const newState = !inputMuted;
      
      await this.obs.call('SetInputMute', { inputName, inputMuted: newState });
      console.log(`[OBS] Toggled "${inputName}" to: ${newState ? 'MUTED' : 'LIVE'}`);
      
      return newState;
    } catch (err) {
      console.error(`Error toggling mute for ${inputName}:`, err);
      throw err;
    }
  }

  /**
   * Explicitly set the mute status.
   * @param inputName The name of the audio source (e.g., 'Mic/Aux')
   * @param muted true to MUTE, false to UNMUTE
   */
  async setInputMute(inputName: string, muted: boolean): Promise<void> {
    if (!this.isConnected) return;
    await this.obs.call('SetInputMute', { inputName, inputMuted: muted });
  }

  // =========================================
  // Private Helpers
  // =========================================

  private assertConnected() {
    if (!this.isConnected) throw new Error('Not connected to OBS');
  }

  /**
   * Retrieves available devices for a specific input kind.
   * Uses a "Probe" pattern: if no input of this kind exists, creates a temp one to query properties.
   */
  private async getDeviceList(inputKind: string): Promise<DeviceOption[]> {
    let probeInputName: string | null = null;

    try {
      // 1. Identify a valid input name to query
      const { inputs } = await this.obs.call('GetInputList', { inputKind });
      
      if (inputs.length > 0) {
        probeInputName = inputs[0].inputName as string;
      } else {
        // Create a temporary probe input if none exists
        probeInputName = `temp_probe_${Date.now()}`;
        await this.obs.call('CreateInput', {
          inputName: probeInputName,
          inputKind: inputKind,
          inputSettings: {},
          sceneName: undefined // Orphaned source
        } as any);
      }

      // 2. Fetch properties (device list) from that input
      const response = await this.obs.call('GetInputPropertiesListPropertyItems', {
        inputName: probeInputName,
        propertyName: 'device_id'
      });

      return response.propertyItems.map(item => ({
        name: item.itemName as string,
        value: item.itemValue as string
      }));

    } catch (error) {
      console.error(`Error getting device list for ${inputKind}:`, error);
      return [];
    } finally {
      // 3. Cleanup: If we created a temp probe, remove it.
      if (probeInputName && probeInputName.startsWith('temp_probe_')) {
        await this.obs.call('RemoveInput', { inputName: probeInputName }).catch(() => {});
      }
    }
  }

  /**
   * Ensures an input exists, has the correct settings, and is assigned to the scene.
   */
  private async ensureInputInScene(
    inputName: string, 
    inputKind: string, 
    settings: Record<string, any>, 
    sceneName: string
  ) {
    // 1. Check or Create/Update Source
    const { inputs } = await this.obs.call('GetInputList');
    const inputExists = inputs.some(i => i.inputName === inputName);

    if (!inputExists) {
      await this.obs.call('CreateInput', {
        inputName,
        inputKind,
        sceneName,
        inputSettings: settings
      });
      console.log(`Created input: ${inputName}`);
    } else {
      await this.obs.call('SetInputSettings', {
        inputName,
        inputSettings: settings,
        overlay: true
      });
    }

    // 2. Ensure Source is in Scene (if it wasn't just created there)
    const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName });
    const isItemInScene = sceneItems.some(item => item.sourceName === inputName);

    if (!isItemInScene) {
      await this.obs.call('CreateSceneItem', { sceneName, sourceName: inputName });
      console.log(`Added "${inputName}" to scene "${sceneName}"`);
    }
  }
}

export const obsService = new OBSService();