/**
 * `POST /v1/binkmix`: the multipart request (`trackIds`, `video`, `sound`)
 * lands in a temporary folder, the passes run one request at a time (one
 * win64 prefix, and the tool is a windowed program), and the mixed video
 * streams back as octet-stream. The folder goes once the response is sent.
 */
import { Busboy } from '@fastify/busboy';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  parseTrackIds,
  replaceBinkTracks,
  wineBinkMixRunner,
  type BinkMixRunner,
  type BinkMixTool,
} from './binkMix';

type Parts = { trackIds: number[] | null; video: string | null; sound: string | null };

/** Save the request's files into `dir`; fields other than `trackIds` are ignored. */
const readParts = (req: IncomingMessage, dir: string): Promise<Parts> =>
  new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (!contentType?.startsWith('multipart/form-data')) {
      reject(new Error('multipart/form-data is required'));
      return;
    }
    const parts: Parts = { trackIds: null, video: null, sound: null };
    const writes: Promise<void>[] = [];
    const bb = new Busboy({ headers: { ...req.headers, 'content-type': contentType } });
    bb.on('field', (name, value) => {
      if (name === 'trackIds') parts.trackIds = parseTrackIds(value);
    });
    bb.on('file', (name, file) => {
      if (name !== 'video' && name !== 'sound') {
        file.resume();
        return;
      }
      const dest = path.join(dir, name === 'video' ? 'in.bk2' : 'sound.wav');
      parts[name] = dest;
      writes.push(pipeline(file, fs.createWriteStream(dest)));
    });
    bb.on('error', reject);
    bb.on('finish', () => {
      Promise.all(writes)
        .then(() => resolve(parts))
        .catch(reject);
    });
    req.pipe(bb);
  });

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

export type BinkMixHandlerOptions = BinkMixTool & {
  timeoutMs: number;
  run?: BinkMixRunner;
};

export const createBinkMixHandler = (opts: BinkMixHandlerOptions) => {
  const run = opts.run ?? wineBinkMixRunner(opts);
  // One request at a time: a promise chain, never rejected, is the whole mutex.
  let queue: Promise<void> = Promise.resolve();

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!fs.existsSync(opts.exe)) {
      sendJson(res, 503, { ok: false, error: `${path.basename(opts.exe)} is not in this image` });
      return;
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bethesda-bink-'));
    res.on('close', () => fs.rmSync(work, { recursive: true, force: true }));
    const parts = await readParts(req, work);
    if (!parts.trackIds || !parts.video || !parts.sound) {
      sendJson(res, 400, { ok: false, error: 'trackIds, video and sound are required' });
      return;
    }
    const output = path.join(work, 'out.bk2');
    const turn = queue.then(() =>
      replaceBinkTracks({
        exe: opts.exe,
        inputBk2: parts.video!,
        soundWav: parts.sound!,
        outputBk2: output,
        trackIds: parts.trackIds!,
        workDir: work,
        run,
        timeoutMs: opts.timeoutMs,
      }),
    );
    queue = turn.catch(() => undefined);
    await turn;
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': fs.statSync(output).size,
    });
    await pipeline(fs.createReadStream(output), res);
  };
};
