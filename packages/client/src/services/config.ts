import Conf from 'conf';
import path from 'path';

// 1. Define the specific shapes of your config sections
interface ObsConfig {
  ip: string;
  port: number;
  password?: string;
}

interface ServerConfig {
  ip: string;
  port: number;
  apiKey: string;
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
  server: ServerConfig;
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
  server: {
    ip: '127.0.0.1', 
    port: 3000,
    apiKey: ''
  },
  paths: {
    output: path.join(process.cwd(), 'recordings'),
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

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.store.get(key);
  }

  public set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    this.store.set(key, value);
  }

  public hasConfigured(): boolean {
    const paths = this.store.get('paths');
    const server = this.store.get('server');
    
    // Check if output path is set AND api key is present
    return !!(paths.output && server.apiKey);
  }
}

export const configService = new ConfigService();