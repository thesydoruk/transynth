/**
 * EET Import routes — upload, list, start/pause/cancel imports with SSE progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Tx } from '../../db.js';
import { log } from '../../logger.js';
import {
  ensureImportSchema,
  listImportJobs,
  getImportJob,
  deleteImportJob,
  registerEetFile,
  runImport,
  isImportRunning,
  requestCancel,
  requestPause,
  updateJobLanguages,
} from '../eetImportService.js';
import { parseEetHeader, iterEetRecords } from '../../bethesda/eetReader.js';

const EET_UPLOAD_DIR = path.resolve(process.env.EET_UPLOAD_DIR ?? './eet-uploads');

const ensureUploadDir = () => {
  if (!fs.existsSync(EET_UPLOAD_DIR)) fs.mkdirSync(EET_UPLOAD_DIR, { recursive: true });
}

const eetFilePath = (fileName: string) => {
  // Sanitize to prevent path traversal
  const safe = path.basename(fileName);
  return path.join(EET_UPLOAD_DIR, safe);
}

export const eetRoutes = async (app: FastifyInstance, db: Tx) => {
  await ensureImportSchema(db);
  ensureUploadDir();

  // ── List all import jobs ──────────────────────────────────────────────────
  app.get('/api/eet', async () => {
    const jobs = await listImportJobs(db);
    return jobs.map(j => ({
      ...j,
      running: isImportRunning(j.id),
    }));
  });

  // ── Upload EET file ───────────────────────────────────────────────────────
  app.post('/api/eet/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file uploaded' });

    const origName = data.filename;
    if (!origName.toLowerCase().endsWith('.eet')) {
      return reply.status(400).send({ error: 'Only .eet files are accepted' });
    }

    // Save to temp, then rename to avoid partial uploads
    const tmpPath = path.join(EET_UPLOAD_DIR, `_upload_${crypto.randomBytes(8).toString('hex')}.tmp`);
    ensureUploadDir();

    try {
      await pipeline(data.file, fs.createWriteStream(tmpPath));

      const finalPath = eetFilePath(origName);
      fs.renameSync(tmpPath, finalPath);

      const buf = fs.readFileSync(finalPath);
      const job = await registerEetFile(db, origName, buf);

      return reply.status(201).send({ ...job, running: false });
    } catch (err: unknown) {
      // Clean up temp file on error
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      log.error(`EET upload failed: ${err instanceof Error ? err.message : err}`);
      return reply.status(500).send({ error: 'Upload failed' });
    }
  });

  // ── Preview EET file records (paginated + filterable) ──────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { page?: string; pageSize?: string; signature?: string; q?: string };
  }>('/api/eet/:id/preview', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });

    const filePath = eetFilePath(job.file_name);
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'EET file not found on disk' });

    const buf = fs.readFileSync(filePath);
    const header = parseEetHeader(buf);

    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));
    const sigFilter = (req.query.signature ?? '').toUpperCase();
    const qFilter = (req.query.q ?? '').toLowerCase();

    // Collect distinct signatures + filtered records in a single pass
    const sigSet = new Set<string>();
    const matched: Array<{ signature: string; formId: string; edid: string; field: string; source: string; target: string; status: number }> = [];

    for (const r of iterEetRecords(buf, header.recordsOffset)) {
      sigSet.add(r.signature);
      if (sigFilter && r.signature !== sigFilter) continue;
      if (qFilter) {
        const hay = `${r.formId}\t${r.edid}\t${r.source}\t${r.target}`.toLowerCase();
        if (!hay.includes(qFilter)) continue;
      }
      matched.push({ signature: r.signature, formId: r.formId, edid: r.edid, field: r.field, source: r.source, target: r.target, status: r.status });
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
      const jobId = Number(req.params.id);
      const job = await getImportJob(db, jobId);
      if (!job) return reply.status(404).send({ error: 'Import job not found' });
      if (isImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot update while running' });

      const { srcLang, tgtLang } = req.body as { srcLang?: string; tgtLang?: string };
      if (srcLang && tgtLang) {
        await updateJobLanguages(db, jobId, srcLang, tgtLang);
      }
      return await getImportJob(db, jobId);
    },
  );

  // ── Start import (SSE stream) ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/eet/:id/import', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (job.status === 'completed') return reply.status(400).send({ error: 'Already completed' });
    if (isImportRunning(jobId)) return reply.status(409).send({ error: 'Import already running' });

    const filePath = eetFilePath(job.file_name);
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'EET file not found on disk' });

    const buf = fs.readFileSync(filePath);

    /* Hijack the response so Fastify does not try to end/serialise it itself —
       we manage the raw SSE stream manually. */
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (data: object) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Run import asynchronously — runImport is now async
    (async () => {
      try {
        const result = await runImport(db as pg.Pool, job, buf, (imported, total) => {
          send({ type: 'progress', imported, total, jobId });
        });
        send({ type: 'done', job: { ...result, running: false } });
      } catch (err: unknown) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        reply.raw.end();
      }
    })();
  });

  // ── Pause import ──────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/eet/:id/pause', async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!isImportRunning(jobId)) return reply.status(400).send({ error: 'Import not running' });
    requestPause(jobId);
    return { ok: true };
  });

  // ── Cancel import ─────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/api/eet/:id/cancel', async (req, reply) => {
    const jobId = Number(req.params.id);
    if (!isImportRunning(jobId)) return reply.status(400).send({ error: 'Import not running' });
    requestCancel(jobId);
    return { ok: true };
  });

  // ── Delete import job + uploaded file ─────────────────────────────────────
  app.delete<{ Params: { id: string } }>('/api/eet/:id', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = await getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (isImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot delete while running' });

    const filePath = eetFilePath(job.file_name);
    try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    await deleteImportJob(db, jobId);

    return { ok: true };
  });
}
