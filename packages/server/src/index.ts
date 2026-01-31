import Fastify from 'fastify';

const server = Fastify({ logger: true });

server.get('/', async (request, reply) => {
  return { hello: 'world', system: 'Meeting Transcriber Server' };
});

const start = async () => {
  try {
    // Listen on 0.0.0.0 to allow LAN connections
    await server.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};
start();