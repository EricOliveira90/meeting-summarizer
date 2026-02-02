import Conf from 'conf';
import path from 'path';

export interface AppConfig {
  serverUrl: string;
  obs: {
    ip: string;
    port: number;
    password?: string;
  };
  paths: {
    output: string;
    obsidianVault?: string;
  };
  devices: {
    micId?: string;
    systemId?: string;
  };
}

const schema = {
  serverUrl: { type: 'string', default: 'http://localhost:3000' },
  obs: {
    type: 'object',
    properties: {
      ip: { type: 'string', default: '127.0.0.1' },
      port: { type: 'number', default: 4455 },
      password: { type: 'string' }
    }
  },
  paths: {
    type: 'object',
    properties: {
      output: { type: 'string' },
      obsidianVault: { type: 'string' }
    }
  },
  devices: {
    type: 'object',
    properties: {
      micId: { type: 'string' },
      systemId: { type: 'string' }
    }
  }
};

class ConfigService {
  private conf: Conf<AppConfig>;

  constructor() {
    this.conf = new Conf<AppConfig>({
        projectName: 'meeting-summarizer-client',
        // @ts-ignore - Schema typing in conf can be tricky with nested objects
        schema: schema 
    });
  }

  get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.conf.get(key);
  }

  set<K extends keyof AppConfig>(key: K, value: AppConfig[K]): void {
    if (key === 'paths') {
       const paths = value as AppConfig['paths'];
       if (paths.output) paths.output = path.normalize(paths.output);
       if (paths.obsidianVault) paths.obsidianVault = path.normalize(paths.obsidianVault);
       this.conf.set(key, paths);
    } else {
       this.conf.set(key, value);
    }
  }
  
  setPath(key: keyof AppConfig['paths'], value: string) {
      const currentPaths = this.get('paths') || {};
      this.set('paths', { ...currentPaths, [key]: path.normalize(value) });
  }

  getAll(): AppConfig {
      return this.conf.store;
  }
  
  hasConfigured(): boolean {
      const c = this.getAll();
      return !!(c.serverUrl && c.paths?.output);
  }
}

export const configService = new ConfigService();
