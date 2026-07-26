import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { Readable } from 'node:stream';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import type { Tx } from '../../../db';
import type { GameType } from '../../../types';
import { isArchive, isPlugin } from '../../../import/mod';
import { registerUploadedModFile } from '../../../import/mod/registerUpload';
import { SUPPORTED_GAMES } from './catalogue';
import {
  downloadNexusFileToDisk,
  fetchNexusFileDownloadUrl,
  fetchNexusModFiles,
  sendNexusKeyMissing,
} from './nexusClient';

export const registerNexusFileRoutes = async (app: FastifyInstance, db: Tx) => {
  /**
   * GET /api/games/:gameId/nexus/mod/:modId/file/:fileId/download
   *
   * Streams a Nexus file through the backend so the browser never talks to
   * Nexus directly.
   */
  app.get<{
    Params: { gameId: string; modId: string; fileId: string };
  }>('/api/games/:gameId/nexus/mod/:modId/file/:fileId/download', async (req, reply) => {
    const { gameId, modId: rawModId, fileId: rawFileId } = req.params;

    if (!CONFIG.nexusApiKey) return sendNexusKeyMissing(reply);

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const modId = parseInt(rawModId, 10);
    const fileId = parseInt(rawFileId, 10);
    if (!Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "modId" must be a positive integer' });
    }
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "fileId" must be a positive integer' });
    }

    try {
      const files = await fetchNexusModFiles(game.domainName, modId);
      const file = files.find((entry) => entry.fileId === fileId);
      if (!file) {
        return reply.code(404).send({ error: 'Nexus file not found' });
      }

      const downloadUrl = await fetchNexusFileDownloadUrl(game.domainName, modId, fileId);
      const upstream = await fetch(downloadUrl, { redirect: 'follow' });
      if (!upstream.ok || !upstream.body) {
        return reply
          .code(502)
          .send({ error: `Nexus file download failed: HTTP ${upstream.status}` });
      }

      const fileName = path.basename(file.fileName ?? file.name);
      const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
      const contentLength = upstream.headers.get('content-length');

      reply.header('Content-Type', contentType);
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      if (contentLength) {
        reply.header('Content-Length', contentLength);
      }

      return reply.send(Readable.fromWeb(upstream.body as never));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`Nexus file proxy failed for ${gameId}/${modId}/${fileId}: ${message}`);
      return reply.code(502).send({ error: message });
    }
  });

  /**
   * POST /api/games/:gameId/nexus/mod/:modId/file/:fileId/import
   *
   * Downloads a Nexus file to local storage and registers a mod import job.
   * The frontend can then immediately start the import stream.
   */
  app.post<{
    Params: { gameId: string; modId: string; fileId: string };
    Body: { srcLang?: string; tgtLang?: string };
  }>('/api/games/:gameId/nexus/mod/:modId/file/:fileId/import', async (req, reply) => {
    const { gameId, modId: rawModId, fileId: rawFileId } = req.params;
    const { srcLang = CONFIG.defaultSrcLang, tgtLang = CONFIG.defaultTgtLang } = req.body ?? {};

    if (!CONFIG.nexusApiKey) return sendNexusKeyMissing(reply);

    const game = SUPPORTED_GAMES.find((g) => g.id === gameId);
    if (!game) return reply.code(404).send({ error: 'Unknown game' });

    const modId = parseInt(rawModId, 10);
    const fileId = parseInt(rawFileId, 10);
    if (!Number.isFinite(modId) || modId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "modId" must be a positive integer' });
    }
    if (!Number.isFinite(fileId) || fileId <= 0) {
      return reply.code(400).send({ error: 'Path parameter "fileId" must be a positive integer' });
    }

    try {
      const files = await fetchNexusModFiles(game.domainName, modId);
      const file = files.find((entry) => entry.fileId === fileId);
      if (!file) {
        return reply.code(404).send({ error: 'Nexus file not found' });
      }

      const fileName = path.basename(file.fileName ?? file.name);
      if (!isPlugin(fileName) && !isArchive(fileName)) {
        return reply.code(400).send({ error: 'Only plugin or archive files can be imported' });
      }

      const localPath = await downloadNexusFileToDisk(game.domainName, modId, fileId, fileName);

      const job = await registerUploadedModFile(db, {
        fileName,
        storedPath: localPath,
        srcLang,
        tgtLang,
        game: game.id as GameType,
      });

      return reply.code(201).send({ ...job, running: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(
        `Nexus file import registration failed for ${gameId}/${modId}/${fileId}: ${message}`,
      );
      return reply.code(502).send({ error: message });
    }
  });
};
