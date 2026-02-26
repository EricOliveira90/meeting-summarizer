import { NoteTemplate } from "@meeting-summarizer/shared";

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
  // The pre-established list of available Obsidian templates (Name -> Path)
  availableTemplates: Record<NoteTemplate, string>; 
  // The specific Obsidian template the user currently wants to use
  activeTemplateName: string; 
}