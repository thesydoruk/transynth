import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'url';
import path from 'path';
import { openDb } from '../db.js';
import { log } from '../logger.js';
import { modsRoutes } from './routes/mods.js';
import { stringsRoutes } from './routes/strings.js';
import { statsRoutes } from './routes/stats.js';
import { glossaryRoutes } from './routes/glossary.js';
import { searchRoutes } from './routes/search.js';
import { eetRoutes } from './routes/eet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_UI_DIST = path.resolve(__dirname, '../../web-ui/dist');

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

// Serve React SPA from web-ui/dist if the directory exists
try {
  await app.register(staticFiles, {
    root: WEB_UI_DIST,
    prefix: '/',
    decorateReply: true,
  });

  // Fallback: serve index.html for all non-API routes (SPA routing)
  app.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html');
  });
} catch {
  // web-ui/dist not present — API-only mode
  log.warn('web-ui/dist not found — running in API-only mode');
}

const db = openDb();

await modsRoutes(app, db);
await stringsRoutes(app, db);
await statsRoutes(app, db);
await glossaryRoutes(app, db);
await searchRoutes(app, db);
await eetRoutes(app, db);

// Health check
app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

try {
  await app.listen({ port: PORT, host: HOST });
  log.info(`Web server listening at http://localhost:${PORT}`);
} catch (err) {
  log.error(err, 'Failed to start web server');
  process.exit(1);
}
