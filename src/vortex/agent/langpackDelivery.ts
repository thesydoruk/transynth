/**
 * Hand a finished langpack to Vortex the way Vortex expects new archives: as a
 * file in its downloads folder, written under a temporary name and renamed
 * into place, so Vortex lists it on the Downloads tab and offers to install it.
 * The agent never deletes anything there.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { VortexLatestLangpack } from '../types';
import type { AgentApi } from './apiClient';

/** Vortex marks the root of its downloads folder with this file. */
export const VORTEX_DOWNLOADS_MARKER = '__vortex_downloads_folder';

export const langpackFileName = (game: string, tgtLang: string, archiveId: number): string =>
  `Transynth_${game}_${tgtLang}_langpack_r${archiveId}.zip`;

/** True when the folder, or its parent, carries Vortex's marker file. */
export const looksLikeVortexDownloads = (downloadsDir: string): boolean =>
  [downloadsDir, path.dirname(downloadsDir)].some((dir) =>
    fs.existsSync(path.join(dir, VORTEX_DOWNLOADS_MARKER)),
  );

/** Deliver when the server has a newer archive than the one last delivered. */
export const shouldDeliver = (
  latest: VortexLatestLangpack | null,
  deliveredArchiveId: number | null,
): latest is VortexLatestLangpack => latest != null && latest.archiveId !== deliveredArchiveId;

export const deliverLangpack = async (
  api: Pick<AgentApi, 'downloadLangpack'>,
  opts: { latest: VortexLatestLangpack; downloadsDir: string; game: string; tgtLang: string },
): Promise<{ fileName: string; bytes: number; skipped: boolean }> => {
  const fileName = langpackFileName(opts.game, opts.tgtLang, opts.latest.archiveId);
  const dest = path.join(opts.downloadsDir, fileName);
  // A crash after the rename but before the state was saved: the file is there.
  if (fs.existsSync(dest)) {
    const size = fs.statSync(dest).size;
    if (opts.latest.byteSize == null || size === opts.latest.byteSize) {
      return { fileName, bytes: size, skipped: true };
    }
  }
  fs.mkdirSync(opts.downloadsDir, { recursive: true });
  const part = `${dest}.part`;
  const bytes = await api.downloadLangpack(opts.latest.runId, part);
  if (opts.latest.byteSize != null && bytes !== opts.latest.byteSize) {
    fs.rmSync(part, { force: true });
    throw new Error(`Langpack download is ${bytes} bytes, server said ${opts.latest.byteSize}`);
  }
  fs.renameSync(part, dest);
  return { fileName, bytes, skipped: false };
};
