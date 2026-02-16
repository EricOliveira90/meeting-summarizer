import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { JobRecord } from '@meeting-summarizer/shared'

interface JobDb {
  jobs: JobRecord[];
}

const file = path.join(process.cwd(), 'db.json');
const adapter = new JSONFile<JobDb>(file);
const db = new Low<JobDb>(adapter, { jobs: [] });

export const getDb = async () => {
  await db.read();
  db.data ||= { jobs: [] }; 
  return db;
};

export type { JobDb };