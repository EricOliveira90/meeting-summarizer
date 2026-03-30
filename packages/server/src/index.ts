import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { FileManagerService } from './services/file-manager';
import { meetingQueue } from './services/queue';
import { recoverStalledJobs, setupGracefulShutdown } from './services/recovery';
import { healthRoutes } from './routes/health';
import { uploadRoutes } from './routes/upload';
import { jobRoutes } from './routes/jobs';

const API_KEY = process.env.API_KEY;

export function buildServer(): FastifyInstance {
  const server = Fastify({
    logger: false,
    bodyLimit: 1048576 * 500, // 500MB
  });

  // --- Services ---
  const fileManager = new FileManagerService(process.cwd());
  server.decorate('fileManager', fileManager);

  // --- Plugins ---
  server.register(cors, { origin: '*' });
  server.register(multipart);

  // --- Authentication ---
  server.addHook('onRequest', async (request, reply) => {
    if (API_KEY) {
      const clientKey = request.headers['x-api-key'];
      if (!clientKey || clientKey !== API_KEY) {
        console.warn(`🔒 Unauthorized access attempt from ${request.ip}`);
        return reply.code(401).send({ error: 'Unauthorized: Invalid or missing API Key' });
      }
    }
  });

  // --- Routes ---
  server.register(healthRoutes);
  server.register(uploadRoutes);
  server.register(jobRoutes);

  return server;
}

// Only start listening if this file is run directly (not imported by tests)
if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3000');
  const HOST = '127.0.0.1';

  const app = buildServer();

  // Bootstrap directories, recover stalled jobs, then start listening
  app.fileManager.ensureDirectories().then(async () => {
    // Recover stalled jobs from previous crash
    await recoverStalledJobs(
      (input) => meetingQueue.push(input),
      app.fileManager
    );

    // Setup graceful shutdown
    setupGracefulShutdown(app, meetingQueue);

    app.listen({ port: PORT, host: HOST }, (err) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      console.log(`\n🚀 Server listening at http://${HOST}:${PORT}`);
    });
  });
}
