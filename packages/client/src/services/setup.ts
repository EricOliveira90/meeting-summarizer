import inquirer from 'inquirer';
import { configService } from './config';

export async function runSetup() {
  console.log('Welcome to Meeting Summarizer Setup');
  
  // Fetch current configs using the new typed getter
  const currentServer = configService.get('server');
  const currentObs = configService.get('obs');
  const currentPaths = configService.get('paths');
  
  const answers = await inquirer.prompt([
    // --- SERVER CONFIG ---
    {
      type: 'input',
      name: 'serverIp',
      message: 'Server IP (LAN IP of the backend):',
      default: currentServer.ip,
    },
    {
      type: 'number',
      name: 'serverPort',
      message: 'Server Port:',
      default: currentServer.port,
    },

    // --- OBS CONFIG ---
    {
      type: 'input',
      name: 'obsIp',
      message: 'OBS WebSocket IP:',
      default: currentObs.ip,
    },
    {
      type: 'number',
      name: 'obsPort',
      message: 'OBS WebSocket Port:',
      default: currentObs.port,
    },
    {
      type: 'password',
      name: 'obsPassword',
      message: 'OBS WebSocket Password (optional):',
      default: currentObs.password,
    },

    // --- PATHS CONFIG ---
    {
      type: 'input',
      name: 'outputPath',
      message: 'Output directory for recordings:',
      default: currentPaths.output,
      filter: (input) => input.trim()
    },
    {
      type: 'input',
      name: 'obsidianVault',
      message: 'Obsidian Vault path (optional):',
      default: currentPaths.obsidianVault,
      filter: (input) => input.trim()
    }
  ]);

  // 1. Save Server Config
  configService.set('server', {
    ip: answers.serverIp,
    port: answers.serverPort
  });

  // 2. Save OBS Config
  configService.set('obs', {
      ip: answers.obsIp,
      port: answers.obsPort,
      password: answers.obsPassword
  });
  
  // 3. Save Paths Config
  configService.set('paths', {
    output: answers.outputPath,
    obsidianVault: answers.obsidianVault || undefined
  });
  
  console.log('✅ Configuration saved successfully!');
  
  // Accessing the internal store path for user debug info
  // We cast to 'any' here because 'store' is private, but helpful to show the user.
  console.log('Config file location:', (configService as any).store.path);
}

// Basic check to see if running directly
if (require.main === module) {
    runSetup().catch(console.error);
}