import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { FileManagerService } from './services/file-manager';
import { meetingQueue } from './services/queue';
import { jobStore } from './services/db';
import { recoverStalledJobs, setupGracefulShutdown } from './services/recovery';
import { healthRoutes } from './routes/health';
import { uploadRoutes } from './routes/upload';
import { jobRoutes } from './routes/jobs';
import type { ServerDependencies } from './domain/ports';

export interface BuildServerOptions {
  apiKey?: string;
  dependencies?: Partial<ServerDependencies>;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const apiKey = options.apiKey ?? process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY is required.');
  }

  const server = Fastify({
    logger: false,
    bodyLimit: 1048576 * 500, // 500MB
  });

  // --- Services ---
  const artifacts = options.dependencies?.artifacts ?? new FileManagerService(process.cwd());
  const resolvedJobStore = options.dependencies?.jobStore ?? jobStore;
  const jobQueue = options.dependencies?.jobQueue ?? meetingQueue;
  server.decorate('fileManager', artifacts);
  server.decorate('artifacts', artifacts);
  server.decorate('jobStore', resolvedJobStore);
  server.decorate('jobQueue', jobQueue);

  // --- Plugins ---
  server.register(cors, { origin: '*' });
  server.register(multipart, {
    limits: { fileSize: 524_288_001 },
    throwFileSizeLimit: false,
  });

  // --- Authentication ---
  server.addHook('onRequest', async (request, reply) => {
    const clientKey = request.headers['x-api-key'];
    if (!clientKey) {
      console.warn(`Unauthorized access attempt from ${request.ip}`);
      return reply.code(401).send({
        code: 'AUTH_REQUIRED',
        error: 'API credential is required.',
      });
    }
    if (clientKey !== apiKey) {
      console.warn(`Unauthorized access attempt from ${request.ip}`);
      return reply.code(401).send({
        code: 'AUTH_INVALID',
        error: 'API credential is invalid.',
      });
    }
  });

  // --- Routes ---
  server.register(healthRoutes);
  server.register(uploadRoutes);
  server.register(jobRoutes);

  return server;
}

export async function startServer(): Promise<void> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.error('CONFIG_API_KEY_REQUIRED');
    console.error('API_KEY is required.');
    process.exitCode = 1;
    return;
  }

  const PORT = parseInt(process.env.PORT || '3000');
  const HOST = '127.0.0.1';

  const app = buildServer({ apiKey });

  // Bootstrap directories, recover stalled jobs, then start listening
  await app.fileManager.ensureDirectories();
  await recoverStalledJobs(
    (input) => meetingQueue.push(input),
    app.fileManager
  );

  setupGracefulShutdown(app, meetingQueue);
  await app.listen({ port: PORT, host: HOST });
  console.log(`\nServer listening at http://${HOST}:${PORT}`);
}

// Only start listening if this file is run directly (not imported by tests)
if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
