import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';

export interface JobRecord {
  id: string;
  originalFilename: string;
  filePath: string;
  uploadDate: string;
  status: 'PENDING' | 'EXTRACTING' | 'TRANSCRIBING' | 'SUMMARIZING' | 'COMPLETED' | 'FAILED';
  
  // Processing Options
  language?: string;
  template?: string;
  minSpeakers?: number;
  maxSpeakers?: number;

  // Outputs
  audioPath?: string;
  transcriptPath?: string;
  summaryPath?: string;
  error?: string;
}

interface Data {
  jobs: JobRecord[];
}

const file = path.join(process.cwd(), 'db.json');
const adapter = new JSONFile<Data>(file);
const db = new Low<Data>(adapter, { jobs: [] });

export const getDb = async () => {
  await db.read();
  db.data ||= { jobs: [] }; 
  return db;
};

export type { Data };