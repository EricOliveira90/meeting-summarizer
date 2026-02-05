import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';

// Define the shape of a Job
export interface JobRecord {
  id: string;
  originalFilename: string;
  filePath: string;
  uploadDate: string;
  status: 'PENDING' | 'EXTRACTING' | 'TRANSCRIBING' | 'SUMMARIZING' | 'COMPLETED' | 'FAILED';
  audioPath?: string;
  transcript?: string;
  summary?: string;
  error?: string;
}

interface Data {
  jobs: JobRecord[];
}

// Initialize LowDB with a default empty array
const file = path.join(process.cwd(), 'db.json');
const adapter = new JSONFile<Data>(file);
const defaultData: Data = { jobs: [] };

export const db = new Low<Data>(adapter, defaultData);

/**
 * Helper to initialize/read the DB ensures we don't read undefined data.
 */
export async function getDb() {
  await db.read();
  db.data ||= defaultData; 
  return db;
}