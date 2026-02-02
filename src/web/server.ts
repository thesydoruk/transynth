import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'url';
import path from 'path';
import { openDb, closeDb } from '../db.js';
import { log } from '../logger.js';
import { CONFIG } from '../config.js';
import { ensureDefaultAdmin, cleanExpiredSessions } from './authService.js';
import { registerAuthHook } from './authMiddleware.js';
import { authRoutes } from './routes/auth.js';
import { usersRoutes } from './routes/users.js';
import { activityRoutes } from './routes/activity.js';
import { modsRoutes } from './routes/mods.js';
import { stringsRoutes } from './routes/strings.js';
import { statsRoutes } from './routes/stats.js';
import { glossaryRoutes } from './routes/glossary.js';
import { searchRoutes } from './routes/search.js';
import { eetRoutes } from './routes/eet.js';
import { csvRoutes } from './routes/csv.js';
import { modImportRoutes } from './routes/modImport.js';
import { tmxRoutes } from './routes/tmx.js';
import { qaRulesRoutes } from './routes/qaRules.js';
import { coherenceRoutes } from './routes/coherence.js';
import { reviewQueueRoutes } from './routes/reviewQueue.js';
import { innrRoutes } from './routes/innr.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_UI_DIST = path.resolve(__dirname, '../../web-ui/dist');

const app = Fastify({ logger: false });

// CORS: in multi-user mode send cookies cross-origin (dev proxy scenario)
await app.register(cors, {
  origin: true,
  credentials: CONFIG.multiUser,
});
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

// Ensure the default admin user exists (required for both modes)
await ensureDefaultAdmin(db);

// Register auth middleware — populates req.user on every request.
// In single-user mode this injects the default admin with zero auth overhead.
await registerAuthHook(app, db);

// Auth, user management, and activity log routes
await authRoutes(app, db);
await usersRoutes(app, db);
await activityRoutes(app, db);

// Domain routes
await modsRoutes(app, db);
await stringsRoutes(app, db);
await statsRoutes(app, db);
await glossaryRoutes(app, db);
await searchRoutes(app, db);
await eetRoutes(app, db);
await csvRoutes(app, db);
await modImportRoutes(app, db);
await tmxRoutes(app, db);
await qaRulesRoutes(app, db);
await coherenceRoutes(app, db);
await reviewQueueRoutes(app, db);
await innrRoutes(app, db);

// Health check — verifies DB connectivity and returns uptime info
app.get('/api/health', async () => {
  try {
    const { rows } = await db.query('SELECT NOW() AS now');
    return { ok: true, ts: new Date().toISOString(), db: true, dbTime: rows[0].now };
  } catch {
    return { ok: false, ts: new Date().toISOString(), db: false };
  }
});

// Periodically clean expired sessions (every 6 hours)
const SESSION_CLEANUP_INTERVAL = 6 * 3600_000;
const sessionCleanup = setInterval(async () => {
  try {
    const removed = await cleanExpiredSessions(db);
    if (removed > 0) log.info(`Cleaned ${removed} expired sessions`);
  } catch (err) {
    log.warn('Session cleanup failed', err);
  }
}, SESSION_CLEANUP_INTERVAL);

log.info(`Auth mode: ${CONFIG.multiUser ? 'multi-user' : 'single-user'}`);

try {
  await app.listen({ port: PORT, host: HOST });
  log.info(`Web server listening at http://localhost:${PORT}`);
} catch (err) {
  log.error(err, 'Failed to start web server');
  process.exit(1);
}

// Graceful shutdown
const shutdown = async () => {
  log.info('Shutting down...');
  clearInterval(sessionCleanup);
  await app.close();
  await closeDb();
  log.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
