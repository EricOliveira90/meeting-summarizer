import Conf from 'conf';
import path from 'path';

// 1. Define the specific shapes of your config sections
interface ObsConfig {
  ip: string;
  port: number;
  password?: string;
}

interface ServerConfig { // <--- New Section for the Fastify Server
  ip: string;
  port: number;
}

interface PathConfig {
  output: string;
  obsidianVault?: string;
}

interface AudioConfig {
  micId?: string;
  systemId?: string;
}

// 2. Main Config Interface
export interface AppConfig {
  obs: ObsConfig;
  server: ServerConfig; // <--- Add to Main Interface
  paths: PathConfig;
  audio: AudioConfig;
}

// 3. Defaults
const defaults: AppConfig = {
  obs: {
    ip: '127.0.0.1',
    port: 4455,
    password: '',
  },
  server: { // <--- Default values for Server
    ip: '127.0.0.1', 
    port: 3000 
  },
  paths: {
    output: path.join(process.cwd(), 'recordings'),
    // obsidianVault is optional, so undefined by default
  },
  audio: {}
};

class ConfigService {
  private store: Conf<AppConfig>;

  constructor() {
    this.store = new Conf<AppConfig>({
      projectName: 'meeting-cli',
      defaults
    });
  }

  /**
   * GENERIC GETTER:
   * This signature tells TypeScript: 
   * "If I ask for 'server', I am GUARANTEED to get back 'ServerConfig'"
   */
  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key);
  }

  public set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  public hasConfigured(): boolean {
    // Simple check to see if we have valid paths
    return !!this.store.get('paths').output;
  }
}

export const configService = new ConfigService();