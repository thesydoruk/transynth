/**
 * bethesda-tools `POST /v1/binkmix`: the video and the dub go up as one
 * multipart request, streamed from disk (the video weighs hundreds of
 * megabytes), and the mixed video streams back into `outPath`.
 */
import fs, { openAsBlob } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Agent, fetch as undiciFetch, FormData } from 'undici';

/**
 * BinkMix takes seconds per track; the sidecar gives a pass five minutes before it
 * gives up on a dialog, and this waits a little longer than that plus the transfer.
 */
const BINKMIX_TIMEOUT_MS = 6 * 60_000;

const mixAgent = new Agent({ headersTimeout: BINKMIX_TIMEOUT_MS, bodyTimeout: BINKMIX_TIMEOUT_MS });

export type BinkMixRequest = {
  videoPath: string;
  soundPath: string;
  trackIds: readonly number[];
  outPath: string;
};

export const binkMixViaRemote = async (baseUrl: string, req: BinkMixRequest): Promise<number> => {
  const form = new FormData();
  form.append('trackIds', req.trackIds.join(','));
  form.append(
    'video',
    await openAsBlob(req.videoPath, { type: 'application/octet-stream' }),
    path.basename(req.videoPath),
  );
  form.append('sound', await openAsBlob(req.soundPath, { type: 'audio/wav' }), 'sound.wav');
  const route = '/v1/binkmix';
  const res = await undiciFetch(`${baseUrl}${route}`, {
    method: 'POST',
    body: form,
    dispatcher: mixAgent,
  }).catch((err: unknown) => {
    const cause =
      err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
    throw new Error(
      `bethesda-tools ${route}: ${err instanceof Error ? err.message : String(err)}${cause}`,
    );
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`bethesda-tools ${route} HTTP ${res.status}: ${detail.slice(0, 240)}`);
  }
  fs.mkdirSync(path.dirname(req.outPath), { recursive: true });
  const part = `${req.outPath}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(part));
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
  const bytes = fs.statSync(part).size;
  if (bytes === 0) {
    fs.rmSync(part, { force: true });
    throw new Error(`bethesda-tools ${route} returned an empty body`);
  }
  fs.renameSync(part, req.outPath);
  return bytes;
};
