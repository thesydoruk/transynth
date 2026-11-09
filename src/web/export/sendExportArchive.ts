/**
 * Stream a finished export archive to the browser.
 *
 * The browser downloads these straight from a link, not through `fetch`: a langpack
 * with voice weighs gigabytes, and a Blob built from a fetched body dies at the
 * browser's blob limit (about 2 GB in Chromium). `Content-Length` lets the download
 * manager show size and progress.
 */
import fs from 'node:fs';
import type { FastifyReply } from 'fastify';
import type { ExportArchiveRow } from '../data/queries/exportArchives';
import { resolveExportArchiveFile } from './exportArchiveFiles';

export const sendExportArchive = (reply: FastifyReply, archive: ExportArchiveRow) => {
  if (archive.status !== 'completed' || !archive.rel_path) {
    return reply.code(409).send({ error: 'Archive is not ready to download' });
  }
  const filePath = resolveExportArchiveFile(archive.rel_path);
  if (!filePath || !fs.existsSync(filePath)) {
    return reply.code(404).send({ error: 'Archive file is missing' });
  }
  return reply
    .header('Content-Type', 'application/zip')
    .header('Content-Length', String(fs.statSync(filePath).size))
    .header('Content-Disposition', `attachment; filename="${archive.file_name}"`)
    .send(fs.createReadStream(filePath));
};
