/**
 * Mod Import routes — upload ESP/ESL or archive (zip/7z/rar),
 * list, preview, start/pause/cancel imports with SSE progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { log } from '../../logger';
import {
  ensureModImportSchema,
  listModImportJobs,
  getModImportJob,
  deleteModImportJob,
  registerPluginFile,
  registerArchiveFile,
  runModImport,
  isModImportRunning,
  requestModCancel,
  requestModPause,
  updateModJobLanguages,
  restartModImportJob,
  previewModRecords,
  isArchive,
  isPlugin,
} from '../modImportService';
import { CONFIG } from '../../config';

import { PATHS } from '../../paths';

const MOD_UPLOAD_DIR = PATHS.modUploads;

const ensureUploadDir = () => {
  if (!fs.existsSync(MOD_UPLOAD_DIR)) fs.mkdirSync(MOD_UPLOAD_DIR, { recursive: true });
};

const modFilePath = (fileName: string) => {
  const safe = path.basename(fileName);
  return path.join(MOD_UPLOAD_DIR, safe);
};

/** Per-archive extraction directory. */
const extractDir = (jobHash: string) => {
  return path.join(MOD_UPLOAD_DIR, `_extracted_${jobHash}`);
};

/** Returns true when a path is inside the mod upload root directory. */
const isInsideModUploadDir = (absPath: string): boolean => {
  const rel = path.relative(MOD_UPLOAD_DIR, absPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Resolves extraction root directory for a plugin path when it follows
 * the uploads/mod/_extracted_* directory layout.
 */
const resolveExtractedRootDir = (pluginPath: string | null | undefined): string | null => {
  if (!pluginPath) return null;
  const absPluginPath = path.resolve(pluginPath);
  if (!isInsideModUploadDir(absPluginPath)) return null;

  let current =
    fs.existsSync(absPluginPath) && fs.statSync(absPluginPath).isDirectory()
      ? absPluginPath
      : path.dirname(absPluginPath);

  while (isInsideModUploadDir(current)) {
    if (path.basename(current).startsWith('_extracted_')) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
};

export const modImportRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureModImportSchema(db);
  ensureUploadDir();

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

      const tmpPath = path.join(
        MOD_UPLOAD_DIR,
        `_upload_${crypto.randomBytes(8).toString('hex')}.tmp`,
      );
      ensureUploadDir();

      try {
        await pipeline(data.file, fs.createWriteStream(tmpPath));

        const finalPath = modFilePath(origName);
        fs.renameSync(tmpPath, finalPath);

        let job;
        if (isPlugin(origName)) {
          job = await registerPluginFile(db, origName, finalPath, srcLang, tgtLang, game);
        } else {
          // Archive — extract then register
          const hash = crypto.randomBytes(8).toString('hex');
          const outDir = extractDir(hash);
          job = await registerArchiveFile(db, origName, finalPath, outDir, srcLang, tgtLang, game);
        }

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

  // ── Preview mod records (paginated + filterable) ──────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; pageSize?: string; signature?: string; q?: string };
  }>('/api/mod-import/:id/preview', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getModImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });

    try {
      const { rows: allRows, locales, isLocalized } = previewModRecords(job);

      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
      const sigFilter = (req.query.signature ?? '').toUpperCase();
      const qFilter = (req.query.q ?? '').toLowerCase();

      const sigSet = new Set<string>();
      const matched: typeof allRows = [];

      for (const r of allRows) {
        if (r.signature) sigSet.add(r.signature);
        if (sigFilter && r.signature.toUpperCase() !== sigFilter) continue;
        if (qFilter) {
          const hay = `${r.formId}\t${r.edid}\t${r.source}`.toLowerCase();
          if (!hay.includes(qFilter)) continue;
        }
        matched.push(r);
      }

      const total = matched.length;
      const start = (page - 1) * pageSize;
      const rows = matched.slice(start, start + pageSize);

      return {
        rows,
        total,
        page,
        pageSize,
        signatures: [...sigSet].sort(),
        locales,
        isLocalized,
      };
    } catch (err: unknown) {
      log.error(`Mod preview failed: ${err instanceof Error ? err.message : err}`);
      return reply
        .status(500)
        .send({ error: err instanceof Error ? err.message : 'Preview failed' });
    }
  });

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

    // Remove all known plugin/archive files connected to the import.
    const filePaths = new Set<string>();
    filePaths.add(modFilePath(job.file_name));
    if (job.esp_path) filePaths.add(job.esp_path);
    if (modAbsPath) filePaths.add(modAbsPath);

    for (const filePath of filePaths) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* file may not exist */
      }
    }

    // Remove extracted archive folder when this import was unpacked.
    const extractedDirs = new Set<string>();
    const fromJobEsp = resolveExtractedRootDir(job.esp_path);
    const fromModAbs = resolveExtractedRootDir(modAbsPath);
    if (fromJobEsp) extractedDirs.add(fromJobEsp);
    if (fromModAbs) extractedDirs.add(fromModAbs);

    for (const dirPath of extractedDirs) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    // Split delete modes:
    // - job  : remove import job only
    // - rows : remove imported records/strings/translations but keep mod row
    // - mod  : remove mod row (records/strings cascade via FK)
    if (job.mod_id != null && deleteData === 'rows') {
      await db.query(`DELETE FROM records WHERE mod_id = $1`, [job.mod_id]);
    }

    if (job.mod_id != null && deleteData === 'mod') {
      await db.query(`DELETE FROM mods WHERE id = $1`, [job.mod_id]);
    }

    await deleteModImportJob(db, jobId);

    return { ok: true };
  });
};
