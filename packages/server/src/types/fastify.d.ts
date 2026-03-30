import { FileManagerService } from '../services/file-manager';

declare module 'fastify' {
  interface FastifyInstance {
    fileManager: FileManagerService;
  }
}
