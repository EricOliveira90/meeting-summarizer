import type { ArtifactStore, JobQueue, JobStore } from '../domain/ports';

declare module 'fastify' {
  interface FastifyInstance {
    fileManager: ArtifactStore;
    artifacts: ArtifactStore;
    jobQueue: JobQueue;
    jobStore: JobStore;
  }
}
