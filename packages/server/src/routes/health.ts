import { FastifyInstance } from 'fastify';

export async function healthRoutes(server: FastifyInstance) {
  server.get('/', async () => ({
    status: 'online',
    service: 'Meeting Summarizer Server'
  }));
}
