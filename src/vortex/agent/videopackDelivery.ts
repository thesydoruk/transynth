/**
 * Hand the group's dubbed videos to Vortex the way the langpack goes: one
 * archive in its downloads folder, written under a temporary name and renamed
 * into place. The server builds the archive from the videos it wrote the dubs
 * into; its version is a hash of which videos carry which dub, so the agent
 * delivers once per change and names the file after the version.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { VortexLatestVideopack } from '../types';
import type { AgentApi } from './apiClient';

export const videopackFileName = (game: string, tgtLang: string, version: string): string =>
  `Transynth_${game}_${tgtLang}_videopack_${version.slice(0, 8)}.zip`;

/** Deliver when the server's videopack is not the one last delivered. */
export const shouldDeliverVideopack = (
  latest: VortexLatestVideopack | null | undefined,
  deliveredVersion: string | null,
): latest is VortexLatestVideopack => latest != null && latest.version !== deliveredVersion;

export const deliverVideopack = async (
  api: Pick<AgentApi, 'downloadVideopack'>,
  opts: {
    groupId: number;
    latest: VortexLatestVideopack;
    downloadsDir: string;
    game: string;
    tgtLang: string;
  },
): Promise<{ fileName: string; bytes: number; skipped: boolean }> => {
  const fileName = videopackFileName(opts.game, opts.tgtLang, opts.latest.version);
  const dest = path.join(opts.downloadsDir, fileName);
  // A crash after the rename but before the state was saved: the file is there.
  if (fs.existsSync(dest)) return { fileName, bytes: fs.statSync(dest).size, skipped: true };
  fs.mkdirSync(opts.downloadsDir, { recursive: true });
  const part = `${dest}.part`;
  let bytes: number;
  try {
    bytes = await api.downloadVideopack(opts.groupId, part);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  fs.renameSync(part, dest);
  return { fileName, bytes, skipped: false };
};
