import inquirer from 'inquirer';
import { CodexReadiness } from '../domain';
import { checkCodexReadiness } from './codexProvider';
import { configService } from './config';

export interface SetupDependencies {
  checkCodexReadiness?: (model: string) => Promise<CodexReadiness>;
}

export async function runSetup(
  dependencies: SetupDependencies = {},
): Promise<CodexReadiness> {
  console.log('Welcome to Meeting Summarizer Setup');
  
  // Fetch current configs using the new typed getter
  const currentServer = configService.get('server');
  const currentPaths = configService.get('paths');
  const currentCodex = configService.get('codex');
  
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
    {
      type: 'input',
      name: 'apikey',
      message: 'Server API Key:',
      default: currentServer.apiKey,
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
    },
    {
      type: 'input',
      name: 'codexModel',
      message: 'Codex model:',
      default: currentCodex.model,
      filter: (input) => input.trim()
    }
  ]);

  // 1. Save Server Config
  configService.set('server', {
    ip: answers.serverIp,
    port: answers.serverPort,
    apiKey: answers.apikey
  });

  // 2. Save Paths Config
  configService.set('paths', {
    output: answers.outputPath,
    obsidianVault: answers.obsidianVault || undefined
  });

  configService.set('defaultProvider', 'codex');
  configService.set('codex', {
    model: answers.codexModel
  });

  const readiness = await (
    dependencies.checkCodexReadiness ?? checkCodexReadiness
  )(answers.codexModel);
  console.log(
    'Codex executable:',
    readiness.executable.status,
    readiness.executable.reason ?? ''
  );
  console.log(
    'Codex authentication:',
    readiness.authentication.status,
    readiness.authentication.reason ?? ''
  );
  console.log(
    'Codex model:',
    readiness.model.status,
    readiness.model.reason ?? ''
  );
  
  console.log('✅ Configuration saved successfully!');
  
  // Accessing the internal store path for user debug info
  // We cast to 'any' here because 'store' is private, but helpful to show the user.
  console.log('Config file location:', (configService as any).store.path);
  return readiness;
}

// Basic check to see if running directly
if (require.main === module) {
    runSetup().catch(console.error);
}
