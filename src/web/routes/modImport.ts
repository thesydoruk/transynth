/**
 * Mod Import routes — upload ESP/ESL or archive (zip/7z/rar),
 * list, start/pause/cancel imports with SSE progress.
 */
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { log } from '../../logger';
import { deleteModData } from '../data/queries';
import { deleteModsCompletely, scheduleModDeleteFileCleanup } from '../import/modDeleteService';
import {
  ensureModImportSchema,
  listModImportJobs,
  getModImportJob,
  deleteModImportJob,
  runModImport,
  isModImportRunning,
  requestModCancel,
  requestModPause,
  updateModJobLanguages,
  restartModImportJob,
  isArchive,
  isPlugin,
} from '../import/modImport';
import { CONFIG } from '../../config';
import { ensureModStorageDir, modUploadTempPath, modUploadedFilePath } from '../../modStorage';
import { registerUploadedModFile } from '../import/registerModUpload';

export const modImportRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureModImportSchema(db);
  ensureModStorageDir();

  // ── List all mod import jobs ──────────────────────────────────────────────
  app.get('/api/mod-import', async () => {
    const jobs = await listModImportJobs(db);
    return jobs.map((j) => ({
      ...j,
      running: isModImportRunning(j.id),
    }));
  });

  // ── Upload mod file (ESP/ESL or archive) ──────────────────────────────────
  app.post<{ Querystring: { game?: string; srcLang?: string; tgtLang?: string } }>(
    '/api/mod-import/upload',
    async (req, reply) => {
      const data = await req.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const origName = data.filename;
      const game: GameType =
        req.query.game === 'sse' ||
        req.query.game === 'sle' ||
        req.query.game === 'fo76' ||
        req.query.game === 'fo3' ||
        req.query.game === 'fnv' ||
        req.query.game === 'ob' ||
        req.query.game === 'mw'
          ? req.query.game
          : 'fo4';
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const tgtLang = req.query.tgtLang ?? CONFIG.defaultTgtLang;

      if (!isPlugin(origName) && !isArchive(origName)) {
        return reply.status(400).send({
          error: 'Only .esp/.esm/.esl plugin files or .zip/.7z/.rar archives are accepted',
        });
      }

      const tmpPath = modUploadTempPath();
      ensureModStorageDir();

      try {
        await pipeline(data.file, fs.createWriteStream(tmpPath));

        const finalPath = modUploadedFilePath(origName);
        fs.renameSync(tmpPath, finalPath);

        const job = await registerUploadedModFile(db, {
          fileName: origName,
          storedPath: finalPath,
          srcLang,
          tgtLang,
          game,
        });

        return reply.status(201).send({ ...job, running: false });
      } catch (err: unknown) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        log.error(`Mod upload failed: ${err instanceof Error ? err.message : err}`);
        return reply
          .status(500)
          .send({ error: err instanceof Error ? err.message : 'Upload failed' });
      }
    },
  );

  // ── Update job languages ──────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { srcLang: string; tgtLang: string } }>(
    '/api/mod-import/:id',
    async (req, reply) => {
      const jobId = Number(req.params.id);
      const job = await getModImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });
      if (isModImportRunning(jobId))
        return reply.status(409).send({ error: 'Cannot update while running' });

      const { srcLang, tgtLang } = req.body as {
        srcLang?: string;
        tgtLang?: string;
      };
      if (srcLang && tgtLang) {
        await updateModJobLanguages(db, jobId, srcLang, tgtLang);
      }
      return await getModImportJob(db, jobId);
    },
  );

  // ── Restart completed/failed/paused job ──────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/mod-import/:id/restart', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getModImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (isModImportRunning(jobId))
      return reply.status(409).send({ error: 'Cannot restart while running' });

    await restartModImportJob(db, jobId);
    return await getModImportJob(db, jobId);
  });

  // ── Start import (SSE stream) ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/mod-import/:id/import', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getModImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (job.status === 'completed') return reply.status(400).send({ error: 'Already completed' });
    if (isModImportRunning(jobId))
      return reply.status(409).send({ error: 'Import already running' });

    if (!job.esp_path || !fs.existsSync(job.esp_path)) {
      return reply.status(404).send({ error: 'Plugin file not found on disk' });
    }

    /* Disable socket timeout — imports can run for minutes on large files. */
    req.raw.socket.setTimeout(0);

    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (data: object) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* client disconnected */
      }
    };

    (async () => {
      try {
        const result = await runModImport(db, job, (imported, total) => {
          send({ type: 'progress', imported, total, jobId });
        });
        send({ type: 'done', job: { ...result, running: false } });
      } catch (err: unknown) {
        log.error(
          `[Mod SSE #${jobId}] Import stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });

  // ── Pause import ──────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/mod-import/:id/pause', async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!isModImportRunning(jobId)) return reply.status(400).send({ error: 'Import not running' });
    requestModPause(jobId);
    return { ok: true };
  });

  // ── Cancel import ─────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/mod-import/:id/cancel', async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!isModImportRunning(jobId)) return reply.status(400).send({ error: 'Import not running' });
    requestModCancel(jobId);
    return { ok: true };
  });

  // ── Delete import job + uploaded file ─────────────────────────────────────
  app.delete<{
    Params: { id: string };
    Querystring: { deleteData?: 'job' | 'rows' | 'mod' };
  }>('/api/mod-import/:id', async (req, reply) => {
    const jobId = Number(req.params.id);
    const deleteData = req.query.deleteData ?? 'mod';
    if (!['job', 'rows', 'mod'].includes(deleteData)) {
      return reply.status(400).send({ error: 'Invalid deleteData mode' });
    }
    const job = await getModImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (isModImportRunning(jobId))
      return reply.status(409).send({ error: 'Cannot delete while running' });

    let modAbsPath: string | null = null;
    if (job.mod_id != null) {
      const { rows } = await db.query<{ abs_path: string | null }>(
        `SELECT abs_path FROM mods WHERE id = $1`,
        [job.mod_id],
      );
      modAbsPath = rows[0]?.abs_path ?? null;
    }

    // DB first — large mods were timing out when CASCADE ran after slow fs.rmSync.
    if (job.mod_id != null && deleteData === 'mod') {
      await deleteModsCompletely(db, [job.mod_id]);
      return { ok: true };
    }

    if (job.mod_id != null && deleteData === 'rows') {
      await deleteModData(db, job.mod_id, 'rows');
    }

    await deleteModImportJob(db, jobId);

    scheduleModDeleteFileCleanup(
      [job],
      job.mod_id != null ? new Map([[job.mod_id, modAbsPath]]) : new Map(),
    );

    return { ok: true };
  });
};
