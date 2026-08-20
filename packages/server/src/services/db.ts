import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import { JobRecord } from '../domain/models';
import type { JobStore } from '../domain/ports';

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

export const jobStore: JobStore = {
  async getAll() {
    const database = await getDb();
    return database.data.jobs;
  },

  async getById(id) {
    const database = await getDb();
    return database.data.jobs.find((job) => job.id === id);
  },

  async replace(job) {
    const database = await getDb();
    const index = database.data.jobs.findIndex((candidate) => candidate.id === job.id);
    if (index === -1) {
      database.data.jobs.push(job);
    } else {
      database.data.jobs[index] = job;
    }
    await database.write();
  },

  async delete(id) {
    const database = await getDb();
    const index = database.data.jobs.findIndex((job) => job.id === id);
    if (index !== -1) {
      database.data.jobs.splice(index, 1);
      await database.write();
    }
  },
};

export type { JobDb };
