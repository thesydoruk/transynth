/**
 * EET Import routes — upload, list, start/pause/cancel imports with SSE progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { DEFAULT_GAME_ID, gamePlugin, isGameId } from '../../games/registry';
import type { GameId } from '../../types';
import { log } from '../../logger';
import {
  ensureImportSchema,
  listImportJobs,
  getImportJob,
  deleteImportJob,
  registerEetFile,
  eetNamesOtherGame,
  updateJobLanguages,
  markImportJobFailed,
} from '../../import/eet';
import {
  cancelQueuedImport,
  isImportQueued,
  listQueuedImportIds,
  pauseQueuedImport,
} from '../../../worker/src/api/importJobs';
import { startJobSse } from '../../../worker/src/api/startJobSse';
import { parseRouteId } from './parseRouteId';
import { parseEetHeader, iterEetRecords } from '../../formats/eet';

import { PATHS } from '../../paths';

const EET_UPLOAD_DIR = PATHS.eetUploads;

const ensureUploadDir = () => {
  if (!fs.existsSync(EET_UPLOAD_DIR)) fs.mkdirSync(EET_UPLOAD_DIR, { recursive: true });
};

const eetFilePath = (fileName: string) => {
  // Sanitize to prevent path traversal
  const safe = path.basename(fileName);
  return path.join(EET_UPLOAD_DIR, safe);
};

export const eetRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureImportSchema(db);
  ensureUploadDir();

  // ── List all import jobs ──────────────────────────────────────────────────
  app.get('/api/eet', async () => {
    const [jobs, queuedIds] = await Promise.all([
      listImportJobs(db),
      listQueuedImportIds('eet-import'),
    ]);
    return jobs.map((j) => ({
      ...j,
      running: queuedIds.has(j.id),
    }));
  });

  // ── Upload EET file ───────────────────────────────────────────────────────
  // The game and languages come from the page the file was uploaded on, as for
  // a mod upload. The file's header names its own game too; when that name
  // proves a different game the upload is refused rather than filed under the
  // wrong one or quietly moved to a page the user is not looking at.
  app.post<{ Querystring: { game?: string; srcLang?: string; tgtLang?: string } }>(
    '/api/eet/upload',
    async (req, reply) => {
      const data = await req.file();
      if (!data) return reply.status(400).send({ error: 'No file uploaded' });

      const origName = data.filename;
      if (!origName.toLowerCase().endsWith('.eet')) {
        return reply.status(400).send({ error: 'Only .eet files are accepted' });
      }
      const game: GameId = isGameId(req.query.game) ? req.query.game : DEFAULT_GAME_ID;
      const srcLang = req.query.srcLang ?? CONFIG.defaultSrcLang;
      const tgtLang = req.query.tgtLang ?? CONFIG.defaultTgtLang;

      // Save to temp, then rename to avoid partial uploads
      const tmpPath = path.join(
        EET_UPLOAD_DIR,
        `_upload_${crypto.randomBytes(8).toString('hex')}.tmp`,
      );
      ensureUploadDir();

      try {
        await pipeline(data.file, fs.createWriteStream(tmpPath));

        // Checked before the rename, which would replace an earlier upload of
        // the same name that a job may still point at.
        const buf = fs.readFileSync(tmpPath);
        const fileGame = parseEetHeader(buf).gameName;
        if (eetNamesOtherGame(fileGame, game)) {
          fs.unlinkSync(tmpPath);
          return reply.status(400).send({
            error: `${origName} is an EET file for ${fileGame}, not ${gamePlugin(game).catalogue.name}`,
            code: 'eet-game-mismatch',
            fileGame,
          });
        }

        fs.renameSync(tmpPath, eetFilePath(origName));
        const job = await registerEetFile(db, origName, buf, { game, srcLang, tgtLang });

        return reply.status(201).send({ ...job, running: false });
      } catch (err: unknown) {
        // Clean up temp file on error
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        log.error(`EET upload failed: ${err instanceof Error ? err.message : err}`);
        return reply.status(500).send({ error: 'Upload failed' });
      }
    },
  );

  // ── Preview EET file records (paginated + filterable) ──────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; pageSize?: string; signature?: string; q?: string };
  }>('/api/eet/:id/preview', async (req, reply) => {
    const jobId = parseRouteId(req.params.id);
    if (jobId === null) return reply.status(400).send({ error: 'Invalid import job id' });
    const job = await getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });

    const filePath = eetFilePath(job.file_name);
    if (!fs.existsSync(filePath))
      return reply.status(404).send({ error: 'EET file not found on disk' });

    const buf = fs.readFileSync(filePath);
    const header = parseEetHeader(buf);

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
    const sigFilter = (req.query.signature ?? '').toUpperCase();
    const qFilter = (req.query.q ?? '').toLowerCase();

    // Collect distinct signatures + filtered records in a single pass
    const sigSet = new Set<string>();
    const matched: Array<{
      signature: string;
      formId: string;
      edid: string;
      field: string;
      source: string;
      target: string;
      status: number;
    }> = [];

    for (const r of iterEetRecords(buf, header.recordsOffset)) {
      sigSet.add(r.signature);
      if (sigFilter && r.signature !== sigFilter) continue;
      if (qFilter) {
        const hay = `${r.formId}\t${r.edid}\t${r.source}\t${r.target}`.toLowerCase();
        if (!hay.includes(qFilter)) continue;
      }
      matched.push({
        signature: r.signature,
        formId: r.formId,
        edid: r.edid,
        field: r.field,
        source: r.source,
        target: r.target,
        status: r.status,
      });
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
    };
  });

  // ── Update job languages ──────────────────────────────────────────────────
  app.patch<{ Params: { id: string }; Body: { srcLang: string; tgtLang: string } }>(
    '/api/eet/:id',
    async (req, reply) => {
      const jobId = parseRouteId(req.params.id);
      if (jobId === null) return reply.status(400).send({ error: 'Invalid import job id' });
      const job = await getImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });
      if (await isImportQueued('eet-import', jobId))
        return reply.status(409).send({ error: 'Cannot update while running' });

      const { srcLang, tgtLang } = req.body as { srcLang?: string; tgtLang?: string };
      if (srcLang && tgtLang) {
        await updateJobLanguages(db, jobId, srcLang, tgtLang);
      }
      return await getImportJob(db, jobId);
    },
  );

  // ── Start import (SSE stream) ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/eet/:id/import', async (req, reply) => {
    const jobId = parseRouteId(req.params.id);
    if (jobId === null) return reply.status(400).send({ error: 'Invalid import job id' });
    const job = await getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (job.status === 'completed') return reply.status(400).send({ error: 'Already completed' });
    if (await isImportQueued('eet-import', jobId))
      return reply.status(409).send({ error: 'Import already running' });

    const filePath = eetFilePath(job.file_name);
    if (!fs.existsSync(filePath))
      return reply.status(404).send({ error: 'EET file not found on disk' });

    await startJobSse(req, reply, {
      data: { kind: 'eet-import', modId: null, params: { importJobId: jobId } },
      initialSnapshotData: { importJobId: jobId },
    });
  });

  // ── Pause import ──────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/eet/:id/pause', async (req, reply) => {
    const jobId = parseRouteId(req.params.id);
    if (jobId === null) return reply.status(400).send({ error: 'Invalid import job id' });
    if (!(await pauseQueuedImport('eet-import', jobId)))
      return reply.status(400).send({ error: 'Import not running' });
    return { ok: true };
  });

  // ── Cancel import ─────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/eet/:id/cancel', async (req, reply) => {
    const jobId = parseRouteId(req.params.id);
    if (jobId === null) return reply.status(400).send({ error: 'Invalid import job id' });
    if (!(await cancelQueuedImport('eet-import', jobId)))
      return reply.status(400).send({ error: 'Import not running' });
    const job = await getImportJob(db, jobId);
    if (job) await markImportJobFailed(db, jobId, job.imported_records, 'Cancelled by user');
    return { ok: true };
  });

  // ── Delete import job + uploaded file ─────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/eet/:id', async (req, reply) => {
    const jobId = parseRouteId(req.params.id);
    if (jobId === null) return reply.status(400).send({ error: 'Invalid import job id' });
    const job = await getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (await isImportQueued('eet-import', jobId))
      return reply.status(409).send({ error: 'Cannot delete while running' });

    const filePath = eetFilePath(job.file_name);
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* file may not exist */
    }
    await deleteImportJob(db, jobId);

    return { ok: true };
  });
};
