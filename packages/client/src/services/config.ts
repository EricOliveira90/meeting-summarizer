import Conf from 'conf';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from the package root
dotenv.config({ path: path.join(__dirname, '../../.env') });

// 1. Define the specific shapes of the config sections
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
    ip: process.env.OBS_IP || '127.0.0.1',
    port: Number(process.env.OBS_PORT) || 4455,
    password: process.env.OBS_PASSWORD || ''
  },
  server: {
    ip: process.env.SERVER_IP || '127.0.0.1',
    port: Number(process.env.SERVER_PORT) || 3000,
    apiKey: process.env.API_KEY || ''
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