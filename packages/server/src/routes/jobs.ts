import { FastifyInstance } from 'fastify';
import { getDb } from '../services';

export async function jobRoutes(server: FastifyInstance) {
  server.get('/jobs', async (req, reply) => {
    const db = await getDb();
    return db.data.jobs.map(job => ({
      id: job.id,
      status: job.status,
      filename: job.originalFilename,
      createdAt: job.uploadDate,
      language: job.language,
      template: job.template
    }));
  });
}