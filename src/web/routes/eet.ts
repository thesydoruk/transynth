/**
 * EET Import routes — upload, list, start/pause/cancel imports with SSE progress.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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
} from '../eetImportService.js';

const EET_UPLOAD_DIR = path.resolve(process.env.EET_UPLOAD_DIR ?? './eet-uploads');

function ensureUploadDir() {
  if (!fs.existsSync(EET_UPLOAD_DIR)) fs.mkdirSync(EET_UPLOAD_DIR, { recursive: true });
}

function eetFilePath(fileName: string) {
  // Sanitize to prevent path traversal
  const safe = path.basename(fileName);
  return path.join(EET_UPLOAD_DIR, safe);
}

export async function eetRoutes(app: FastifyInstance, db: Tx) {
  ensureImportSchema(db);
  ensureUploadDir();

  // ── List all import jobs ──────────────────────────────────────────────────
  app.get('/api/eet', async () => {
    const jobs = listImportJobs(db);
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
      const job = registerEetFile(db, origName, buf);

      return reply.status(201).send({ ...job, running: false });
    } catch (err: unknown) {
      // Clean up temp file on error
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      log.error(`EET upload failed: ${err instanceof Error ? err.message : err}`);
      return reply.status(500).send({ error: 'Upload failed' });
    }
  });

  // ── Start import (SSE stream) ─────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/api/eet/:id/import', async (req, reply) => {
    const jobId = Number(req.params.id);
    const job = getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (job.status === 'completed') return reply.status(400).send({ error: 'Already completed' });
    if (isImportRunning(jobId)) return reply.status(409).send({ error: 'Import already running' });

    const filePath = eetFilePath(job.file_name);
    if (!fs.existsSync(filePath)) return reply.status(404).send({ error: 'EET file not found on disk' });

    const buf = fs.readFileSync(filePath);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (data: object) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Run import in a setImmediate so the SSE headers flush first
    setImmediate(() => {
      try {
        const result = runImport(db, job, buf, (imported, total) => {
          send({ type: 'progress', imported, total, jobId });
        });
        send({ type: 'done', job: { ...result, running: false } });
      } catch (err: unknown) {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) });
      } finally {
        reply.raw.end();
      }
    });
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
    const job = getImportJob(db, jobId);
    if (!job) return reply.status(404).send({ error: 'Import job not found' });
    if (isImportRunning(jobId)) return reply.status(409).send({ error: 'Cannot delete while running' });

    const filePath = eetFilePath(job.file_name);
    try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    deleteImportJob(db, jobId);

    return { ok: true };
  });
}
