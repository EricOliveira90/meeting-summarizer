import inquirer from 'inquirer';
import { configService } from './services/config';

export async function runSetup() {
  console.log('Welcome to Meeting Summarizer Setup');
  
  const currentConfig = configService.getAll();
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'serverUrl',
      message: 'Server URL:',
      default: currentConfig.serverUrl || 'http://localhost:3000',
    },
    {
      type: 'input',
      name: 'obsIp',
      message: 'OBS WebSocket IP:',
      default: currentConfig.obs?.ip || '127.0.0.1',
    },
    {
      type: 'number',
      name: 'obsPort',
      message: 'OBS WebSocket Port:',
      default: currentConfig.obs?.port || 4455,
    },
    {
      type: 'password',
      name: 'obsPassword',
      message: 'OBS WebSocket Password (optional):',
      default: currentConfig.obs?.password,
    },
    {
      type: 'input',
      name: 'outputPath',
      message: 'Output directory for recordings:',
      default: currentConfig.paths?.output || process.cwd(),
      filter: (input) => input.trim()
    },
     {
      type: 'input',
      name: 'obsidianVault',
      message: 'Obsidian Vault path (optional):',
      default: currentConfig.paths?.obsidianVault,
      filter: (input) => input.trim()
    }
  ]);

  configService.set('serverUrl', answers.serverUrl);
  configService.set('obs', {
      ip: answers.obsIp,
      port: answers.obsPort,
      password: answers.obsPassword
  });
  
  configService.setPath('output', answers.outputPath);
  if (answers.obsidianVault) {
      configService.setPath('obsidianVault', answers.obsidianVault);
  }
  
  console.log('Configuration saved successfully!');
  console.log('Config file location:', (configService as any).conf.path);
}

// Basic check to see if running directly
// In ES modules or ts-node, checking require.main is tricky if pure ESM, but commonjs target is set.
if (require.main === module) {
    runSetup().catch(console.error);
}
