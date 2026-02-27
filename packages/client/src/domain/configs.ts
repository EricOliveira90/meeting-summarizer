import { NoteTemplate } from "./models";

export interface ObsConfig {
  ip: string;
  port: number;
  password?: string;
}

export interface ServerConfig {
  ip: string;
  port: number;
  apiKey: string;
}

export interface PathConfig {
  output: string;
  obsidianVault?: string;
}

export interface AudioConfig {
  micId?: string;
  systemId?: string;
}

export interface ObsidianConfig {
  vaultPath: string;
  notesFolder: string;
  availableTemplates: Record<NoteTemplate, string>;
  activeTemplateName: string;
}

export interface AppConfig {
  obs: ObsConfig;
  server: ServerConfig;
  paths: PathConfig;
  audio: AudioConfig;
  obsidian: ObsidianConfig
}
