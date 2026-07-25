/**
 * CSV Import routes — upload, list, start/pause/cancel imports with SSE progress.
 * Mirrors EET routes but handles CSV files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Tx } from '../../db';
import { log } from '../../logger';
import {
  ensureCsvImportSchema,
  listCsvImportJobs,
  getCsvImportJob,
  deleteCsvImportJob,
  registerCsvFile,
  runCsvImport,
  isCsvImportRunning,
  hasActiveCsvImport,
  requestCsvCancel,
  requestCsvPause,
  updateCsvJobLanguages,
  markCsvImportFailed,
  iterCsvRecords,
} from '../import/csvImport';

import { PATHS } from '../../paths';

const CSV_UPLOAD_DIR = PATHS.csvUploads;

const ensureUploadDir = () => {
  if (!fs.existsSync(CSV_UPLOAD_DIR)) fs.mkdirSync(CSV_UPLOAD_DIR, { recursive: true });
};

const csvFilePath = (fileName: string) => {
  const safe = path.basename(fileName);
  return path.join(CSV_UPLOAD_DIR, safe);
};

export const csvRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureCsvImportSchema(db);
  ensureUploadDir();

  // ── List all CSV import jobs ──────────────────────────────────────────────
  app.get('/api/csv', async () => {
    const jobs = await listCsvImportJobs(db);
    return jobs.map((j) => ({
      ...j,
      running: isCsvImportRunning(j.id),
    }));
  });

  // ── Upload CSV file ───────────────────────────────────────────────────────
  app.post('/api/csv/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const origName = data.filename;
    if (!origName.toLowerCase().endsWith('.csv')) {
      return reply.status(400).send({ error: 'Only .csv files are accepted' });
    }

    const tmpPath = path.join(
      CSV_UPLOAD_DIR,
      `_upload_${crypto.randomBytes(8).toString('hex')}.tmp`,
    );
    ensureUploadDir();

    try {
      await pipeline(data.file, fs.createWriteStream(tmpPath));

      const finalPath = csvFilePath(origName);
      fs.renameSync(tmpPath, finalPath);

      const text = fs.readFileSync(finalPath, 'utf8');
      const job = await registerCsvFile(db, origName, text);

      return reply.status(201).send({ ...job, running: false });
    } catch (err: unknown) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      log.error(`CSV upload failed: ${err instanceof Error ? err.message : err}`);
      return reply.status(500).send({ error: 'Upload failed' });
    }
  });

  // ── Preview CSV file records (paginated + filterable) ─────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; pageSize?: string; signature?: string; q?: string };
  }>('/api/csv/:id/preview', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getCsvImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });

    const filePath = csvFilePath(job.file_name);
    if (!fs.existsSync(filePath))
      return reply.status(404).send({ error: 'CSV file not found on disk' });

    const text = fs.readFileSync(filePath, 'utf8');

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
    const sigFilter = (req.query.signature ?? '').toUpperCase();
    const qFilter = (req.query.q ?? '').toLowerCase();

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

    for (const r of iterCsvRecords(text)) {
      if (r.signature) sigSet.add(r.signature);
      if (sigFilter && r.signature.toUpperCase() !== sigFilter) continue;
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
    '/api/csv/:id',
    async (req, reply) => {
      const jobId = Number(req.params.id);
      const job = await getCsvImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });
      if (isCsvImportRunning(jobId))
        return reply.status(409).send({ error: 'Cannot update while running' });

      const { srcLang, tgtLang } = req.body as { srcLang?: string; tgtLang?: string };
      if (srcLang && tgtLang) {
        await updateCsvJobLanguages(db, jobId, srcLang, tgtLang);
      }
      return await getCsvImportJob(db, jobId);
    },
  );

  // ── Start import (SSE stream) ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/csv/:id/import', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getCsvImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (job.status === 'completed') return reply.status(400).send({ error: 'Already completed' });
    if (isCsvImportRunning(jobId))
      return reply.status(409).send({ error: 'Import already running' });

    const filePath = csvFilePath(job.file_name);
    if (!fs.existsSync(filePath))
      return reply.status(404).send({ error: 'CSV file not found on disk' });

    const text = fs.readFileSync(filePath, 'utf8');

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
        const result = await runCsvImport(db, job, text, (imported, total) => {
          send({ type: 'progress', imported, total, jobId });
        });
        send({ type: 'done', job: { ...result, running: false } });
      } catch (err: unknown) {
        log.error(
          `[CSV SSE #${jobId}] Import stream error: ${err instanceof Error ? err.message : String(err)}`,
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
  app.post<{ Params: { id: string } }>('/api/csv/:id/pause', async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!hasActiveCsvImport(jobId)) return reply.status(400).send({ error: 'Import not running' });
    requestCsvPause(jobId);
    return { ok: true };
  });

  // ── Cancel import ─────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/csv/:id/cancel', async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!hasActiveCsvImport(jobId)) return reply.status(400).send({ error: 'Import not running' });
    requestCsvCancel(jobId);
    const job = await getCsvImportJob(db, jobId);
    if (job) await markCsvImportFailed(db, jobId, job.imported_records);
    return { ok: true };
  });

  // ── Delete import job + uploaded file ─────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/csv/:id', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getCsvImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (isCsvImportRunning(jobId))
      return reply.status(409).send({ error: 'Cannot delete while running' });

    const filePath = csvFilePath(job.file_name);
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* file may not exist */
    }
    await deleteCsvImportJob(db, jobId);

    return { ok: true };
  });
};
