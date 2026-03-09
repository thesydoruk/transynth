/**
 * Mod Import routes — upload ESP/ESL or archive (zip/7z/rar),
 * list, preview, start/pause/cancel imports with SSE progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db.js';
import type { GameType } from '../../types.js';
import { log } from '../../logger.js';
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
  extractModImportApplyRows,
  isArchive,
  isPlugin,
} from '../modImportService.js';
import { CONFIG } from '../../config.js';
import { applyImportedRowsAsTranslations } from '../queries.js';

const MOD_UPLOAD_DIR = path.resolve(process.env.MOD_UPLOAD_DIR ?? './uploads/mod');

const ensureUploadDir = () => {
  if (!fs.existsSync(MOD_UPLOAD_DIR)) fs.mkdirSync(MOD_UPLOAD_DIR, { recursive: true });
}

const modFilePath = (fileName: string) => {
  const safe = path.basename(fileName);
  return path.join(MOD_UPLOAD_DIR, safe);
}

/** Per-archive extraction directory. */
const extractDir = (jobHash: string) => {
  return path.join(MOD_UPLOAD_DIR, `_extracted_${jobHash}`);
}

/** Returns true when a path is inside the mod upload root directory. */
const isInsideModUploadDir = (absPath: string): boolean => {
  const rel = path.relative(MOD_UPLOAD_DIR, absPath);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolves extraction parent directory for a plugin path when it follows
 * the uploads/mod/_extracted_* layout.
 */
const resolveExtractedParentDir = (pluginPath: string | null | undefined): string | null => {
  if (!pluginPath) return null;
  const parentDir = path.dirname(pluginPath);
  if (!isInsideModUploadDir(parentDir)) return null;
  if (!path.basename(parentDir).startsWith('_extracted_')) return null;
  return parentDir;
}

export const modImportRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureModImportSchema(db);
  ensureUploadDir();

  // ── List all mod import jobs ──────────────────────────────────────────────
  app.get('/api/mod-import', async () => {
    const jobs = await listModImportJobs(db);
    return jobs.map(j => ({
      ...j,
      running: isModImportRunning(j.id),
    }));
  });

  // ── Upload mod file (ESP/ESL or archive) ──────────────────────────────────
  app.post<{ Querystring: { game?: string; srcLang?: string; tgtLang?: string } }>('/api/mod-import/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const origName = data.filename;
    const game: GameType = (req.query.game === 'sse' || req.query.game === 'sle' || req.query.game === 'fo76' || req.query.game === 'fo3' || req.query.game === 'fnv') ? req.query.game : 'fo4';
    const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
    const tgtLang = req.query.tgtLang ?? CONFIG.defaultTgtLang;

    if (!isPlugin(origName) && !isArchive(origName)) {
      return reply.status(400).send({
        error: 'Only .esp/.esm/.esl plugin files or .zip/.7z/.rar archives are accepted',
      });
    }

    const tmpPath = path.join(MOD_UPLOAD_DIR, `_upload_${crypto.randomBytes(8).toString('hex')}.tmp`);
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
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      log.error(`Mod upload failed: ${err instanceof Error ? err.message : err}`);
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Upload failed' });
    }
  });

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
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Preview failed' });
    }
  });

  // ── Update job languages ──────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { srcLang: string; tgtLang: string } }>(
    '/api/mod-import/:id',
    async (req, reply) => {
      const jobId = Number(req.params.id);
      const job = await getModImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });
      if (isModImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot update while running' });

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

  // ── Apply import job directly to an existing mod without DB-ingesting the translation mod ──
  app.post<{
    Params: { id: string };
    Querystring: { targetModId?: string; importedLang?: string; srcLang?: string };
  }>(
    '/api/mod-import/:id/apply-to-mod',
    async (req, reply) => {
      const jobId = Number(req.params.id);
      const targetModId = Number(req.query.targetModId);
      const importedLang = (req.query.importedLang ?? '').trim();
      const srcLang = (req.query.srcLang ?? CONFIG.defaultSrcLang).trim() || CONFIG.defaultSrcLang;

      if (!Number.isInteger(jobId) || jobId < 1) return reply.status(400).send({ error: 'Invalid import job id' });
      if (!Number.isInteger(targetModId) || targetModId < 1) return reply.status(400).send({ error: 'targetModId query param is required' });
      if (!importedLang) return reply.status(400).send({ error: 'importedLang query param is required' });
      if (isModImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot apply while import is running' });

      const job = await getModImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });

      try {
        await db.query(
          `UPDATE mod_imports
              SET status = 'in_progress',
                  imported_records = 0,
                  updated_at = NOW()
            WHERE id = $1`,
          [jobId],
        );

        const importedRows = extractModImportApplyRows(job, importedLang);
        if (importedRows.length === 0) {
          return reply.status(400).send({ error: `Import job has no translatable rows for lang "${importedLang}"` });
        }

        let lastProcessed = 0;
        let lastTotal = 0;

        const result = await applyImportedRowsAsTranslations(
          db,
          targetModId,
          importedRows,
          importedLang,
          importedLang,
          srcLang,
          `import_job_${jobId}_${importedLang}`,
          `Imported apply: targetMod=${targetModId}, importJob=${jobId}`,
          async (processed, total) => {
            lastProcessed = processed;
            lastTotal = total;
            await db.query(
              `UPDATE mod_imports
                  SET status = 'in_progress',
                      total_records = $2,
                      imported_records = $3,
                      updated_at = NOW()
                WHERE id = $1`,
              [jobId, total, processed],
            );
          },
        );

        await db.query(
          `UPDATE mod_imports
              SET status = 'completed',
                  total_records = $2,
                  imported_records = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [jobId, lastTotal || lastProcessed || importedRows.length],
        );

        log.info(
          `Imported apply complete: targetMod=${targetModId}, importJob=${jobId}, uploaded file kept on disk, no temporary mod row created`,
        );

        return reply.send(result);
      } catch (err: unknown) {
        await db.query(
          `UPDATE mod_imports
              SET status = 'failed',
                  updated_at = NOW()
            WHERE id = $1`,
          [jobId],
        );
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ── Restart completed/failed/paused job ──────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/mod-import/:id/restart',
    async (req, reply) => {
      const jobId = Number(req.params.id);
      const job = await getModImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });
      if (isModImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot restart while running' });

      await restartModImportJob(db, jobId);
      return await getModImportJob(db, jobId);
    },
  );

  // ── Start import (SSE stream) ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/mod-import/:id/import', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getModImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (job.status === 'completed') return reply.status(400).send({ error: 'Already completed' });
    if (isModImportRunning(jobId)) return reply.status(409).send({ error: 'Import already running' });

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
      try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
    };

    (async () => {
      try {
        const result = await runModImport(db, job, (imported, total) => {
          send({ type: 'progress', imported, total, jobId });
        });
        send({ type: 'done', job: { ...result, running: false } });
      } catch (err: unknown) {
        log.error(`[Mod SSE #${jobId}] Import stream error: ${err instanceof Error ? err.message : String(err)}`);
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        try { reply.raw.end(); } catch { /* already closed */ }
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
  app.delete<{ Params: { id: string } }>('/api/mod-import/:id', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getModImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (isModImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot delete while running' });

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
      try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    }

    // Remove extracted archive folder when this import was unpacked.
    const extractedDirs = new Set<string>();
    const fromJobEsp = resolveExtractedParentDir(job.esp_path);
    const fromModAbs = resolveExtractedParentDir(modAbsPath);
    if (fromJobEsp) extractedDirs.add(fromJobEsp);
    if (fromModAbs) extractedDirs.add(fromModAbs);

    for (const dirPath of extractedDirs) {
      try { fs.rmSync(dirPath, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // If this import created a mod row, remove it too (records/strings cascade).
    if (job.mod_id != null) {
      await db.query(`DELETE FROM mods WHERE id = $1`, [job.mod_id]);
    }

    await deleteModImportJob(db, jobId);

    return { ok: true };
  });
}
