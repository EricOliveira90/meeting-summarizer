import { NoteTemplate } from "./models";

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

export interface AudioRecConfig {
  inputDeviceIndex?: number;
  outputDeviceIndex?: number;
}

export interface ObsidianConfig {
  vaultPath: string;
  notesFolder: string;
  availableTemplates: Record<NoteTemplate, string>;
  activeTemplateName: string;
}

export type SummaryProviderName = 'codex';

export interface CodexConfig {
  model: string;
}

export interface AppConfig {
  audioRec: AudioRecConfig;
  server: ServerConfig;
  paths: PathConfig;
  audio: AudioConfig;
  obsidian: ObsidianConfig;
  defaultProvider: SummaryProviderName;
  codex: CodexConfig;
}
