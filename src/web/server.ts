/**
 * server.ts
 *
 * Fastify HTTP server entry point for the localization web application.
 *
 * Responsibilities:
 * - configure cross-origin behaviour for local development,
 * - serve the built React SPA (when `web-ui/dist` is present),
 * - initialise the database connection,
 * - register all REST API routes under `/api/*`,
 * - and handle graceful shutdown.
 *
 * This file intentionally performs startup work at module top-level so it can
 * be run directly via `tsx src/web/server.ts` and watched in development.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import multipart from '@fastify/multipart';
import { fileURLToPath } from 'url';
import path from 'path';
import { openDb, closeDb } from '../db';
import { log, closeLogStreams } from '../logger';
import { CONFIG, UPLOAD_FILE_SIZE_LIMIT_BYTES } from '../config';
import { ensureDataDirs } from '../paths';
import { ensureModLangStatsColumns } from './services/modLangStats';
import { ensureDefaultUser } from './auth/authService';
import { registerAuthHook } from './auth/authMiddleware';
import { activityRoutes } from './routes/activity';
import { modsRoutes } from './routes/mods';
import { stringsRoutes } from './routes/strings';
import { statsRoutes } from './routes/stats';
import { glossaryRoutes } from './routes/glossary';
import { searchRoutes } from './routes/search';
import { eetRoutes } from './routes/eet';
import { csvRoutes } from './routes/csv';
import { modImportRoutes } from './routes/modImport';
import { qaRulesRoutes } from './routes/qaRules';
import { coherenceRoutes } from './routes/coherence';
import { innrRoutes } from './routes/innr';
import { dialogsRoutes } from './routes/dialogs';
import { opsRoutes } from './routes/ops';
import { settingsRoutes } from './routes/settings';
import { gamesRoutes } from './routes/games';
import { projectSettingsRoutes } from './routes/projectSettings';
import { llmVerifyRoutes } from './routes/llmVerify';
import { llmTranslateRoutes } from './routes/llmTranslate';
import { llmSkipDetectRoutes } from './routes/llmSkipDetect';
import { tmApplyRoutes } from './routes/tmApply';
import { modAiJobsRoutes } from './routes/modAiJobs';
import { modVoiceGenerateRoutes } from './routes/modVoiceGenerate';

/** Directory of this module file (ESM replacement for __dirname). */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const WEB_UI_DIST = path.resolve(__dirname, '../../web-ui/dist');

/** Fastify app instance; Fastify logging is disabled in favour of `src/logger.ts`. */
ensureDataDirs();
const app = Fastify({ logger: false, bodyLimit: UPLOAD_FILE_SIZE_LIMIT_BYTES });

await app.register(cors, {
  origin: true,
  credentials: false,
});
await app.register(multipart, {
  limits: { fileSize: UPLOAD_FILE_SIZE_LIMIT_BYTES },
});

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

await ensureModLangStatsColumns(db);
await ensureDefaultUser(db);
await registerAuthHook(app, db);
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
await qaRulesRoutes(app, db);
await coherenceRoutes(app, db);
await innrRoutes(app, db);
await dialogsRoutes(app, db);
await opsRoutes(app, db);
await settingsRoutes(app);
await gamesRoutes(app, db);
await projectSettingsRoutes(app, db);
await llmVerifyRoutes(app, db);
await llmTranslateRoutes(app, db);
await llmSkipDetectRoutes(app, db);
await tmApplyRoutes(app, db);
await modAiJobsRoutes(app);
await modVoiceGenerateRoutes(app, db);

// Health check — verifies DB connectivity and returns uptime info
app.get('/api/health', async () => {
  try {
    const { rows } = await db.query('SELECT NOW() AS now');
    return { ok: true, ts: new Date().toISOString(), db: true, dbTime: rows[0].now };
  } catch {
    return { ok: false, ts: new Date().toISOString(), db: false };
  }
});

if (!CONFIG.nexusApiKey) {
  log.warn('NEXUS_API_KEY is not set — Nexus Mods search and import are disabled');
}

try {
  await app.listen({ port: PORT, host: HOST });
  log.info(`Web server listening at http://localhost:${PORT}`);
} catch (err) {
  log.error(err, 'Failed to start web server');
  process.exit(1);
}

/**
 * Graceful shutdown handler.
 *
 * Stops background timers, closes the HTTP server, releases database resources,
 * flushes logs, and exits the process.
 */
const shutdown = async () => {
  log.info('Shutting down...');
  await app.close();
  await closeDb();
  closeLogStreams();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection — API kept running', reason);
});
