/**
 * `POST /v1/ffxanim` { text, wav, actor, name?, game? } → raw Starfield `.ffxanim`.
 *
 * `text` is the raw dialogue line (tags and Ukrainian are handled here, see
 * `fonixText.ts`); `wav` is a base64 RIFF/WAVE file; `actor` picks the human face rig
 * (`male` | `female`); `name` becomes the WAV, animation and group name inside the
 * file (letters, digits, `_`; default `take`), so a caller passes the take's WEM id.
 * `game` is accepted and unused: Starfield has the one pair of rigs.
 *
 * Each request gets a private work folder on the container's filesystem and a slot of
 * the win64 prefix pool, which bounds how many takes run at once (LipGenerator is
 * 32-bit, ffxc 64-bit: one WoW64 prefix runs both), and the folder goes when the
 * request ends. Without the tools the route answers 503 "Starfield lip tools are not
 * installed" and nothing else is touched.
 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { FFXANIM_NAME_RE, generateFfxanim, type ToolRunner } from './ffxanim';
import { prepareLipGeneratorText } from './fonixText';
import { decodeWav, readJsonBody, sendBytes, sendJson } from './http';
import {
  StarfieldToolsMissingError,
  starfieldToolPaths,
  type FaceFxActor,
  type StarfieldToolsCache,
} from './starfieldTools';
import { createWineSlotPool, type WineSlot } from './wineSlots';

export const DEFAULT_FFXANIM_NAME = 'take';

export type FfxanimRequest = { text: string; wav: Buffer; actor: FaceFxActor; name: string };

/** The validated request, or the reason it is not one. */
export const parseFfxanimRequest = (body: unknown): FfxanimRequest | { error: string } => {
  const raw = (body ?? {}) as Record<string, unknown>;
  const wav = decodeWav(raw.wav);
  const actor = raw.actor;
  if (typeof raw.text !== 'string' || !wav || (actor !== 'male' && actor !== 'female')) {
    return { error: "text (string), wav (base64) and actor ('male' | 'female') are required" };
  }
  if (wav.toString('latin1', 0, 4) !== 'RIFF' || wav.toString('latin1', 8, 12) !== 'WAVE') {
    return { error: 'wav is not a RIFF/WAVE file' };
  }
  const name = raw.name ?? DEFAULT_FFXANIM_NAME;
  if (typeof name !== 'string' || !FFXANIM_NAME_RE.test(name)) {
    return { error: 'name must be 1-64 letters, digits or _' };
  }
  return { text: raw.text, wav, actor, name };
};

export type FfxanimHandlerOptions = {
  tools: StarfieldToolsCache;
  pool: { acquire: () => Promise<WineSlot>; release: (slot: WineSlot) => void };
  /** Make the slot's prefix ready (first use runs wineboot); memoized by the caller. */
  preparePrefix: (prefix: string) => Promise<void>;
  runner: (prefix: string) => ToolRunner;
  toolPath: (p: string) => string;
  timeoutMs: number;
  /** Parent of the per-request work folders; the OS temp folder by default. */
  workRoot?: string;
};

export const createFfxanimHandler = (opts: FfxanimHandlerOptions) =>
  async function handleFfxanim(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = parseFfxanimRequest(await readJsonBody(req));
    if ('error' in parsed) {
      sendJson(res, 400, { ok: false, error: parsed.error });
      return;
    }
    let root: string;
    try {
      root = await opts.tools.ensure();
    } catch (err) {
      if (!(err instanceof StarfieldToolsMissingError)) throw err;
      sendJson(res, 503, { ok: false, error: err.message, missing: err.missing });
      return;
    }
    const { text, guided } = prepareLipGeneratorText(parsed.text);
    const slot = await opts.pool.acquire();
    const work = fs.mkdtempSync(path.join(opts.workRoot ?? os.tmpdir(), 'bethesda-ffx-'));
    try {
      await opts.preparePrefix(slot.prefix);
      const result = await generateFfxanim({
        tools: starfieldToolPaths(root),
        workDir: work,
        wav: parsed.wav,
        text,
        actor: parsed.actor,
        name: parsed.name,
        run: opts.runner(slot.prefix),
        toolPath: opts.toolPath,
        timeoutMs: opts.timeoutMs,
      });
      sendBytes(res, result.data, {
        'server-timing': `lipgen;dur=${result.lipGeneratorMs}, ffxc;dur=${result.ffxcMs}`,
        'x-ffxanim-text': guided ? 'guided' : 'audio-only',
      });
    } finally {
      opts.pool.release(slot);
      fs.rmSync(work, { recursive: true, force: true });
    }
  };

export type StarfieldLipServiceOptions = Pick<
  FfxanimHandlerOptions,
  'tools' | 'runner' | 'toolPath' | 'timeoutMs'
> & {
  /** Holds the one win64 prefix (`<root>/w0`). */
  prefixRoot: string;
  /** Takes at once. */
  concurrency: number;
  /** What a booted prefix still needs (the server's `wineserver -p`). */
  initPrefix: (prefix: string) => Promise<void>;
};

/**
 * The route as the server runs it: LipGenerator (32-bit) and ffxc (64-bit) in one
 * win64 (WoW64) prefix of their own, `concurrency` takes at once. One prefix, not one
 * per slot: each take has its own work folder and the tools write nothing else, 4 ffxc
 * builds in one prefix took as long as 2 + 2 in two, and a win64 prefix is 1.3 GB.
 * wineboot goes through the runner, which returns when wineboot exits (see
 * `wineToolRunner`), and runs once, on warm-up or the first take.
 */
export const createStarfieldLipService = (opts: StarfieldLipServiceOptions) => {
  const pool = createWineSlotPool(opts.prefixRoot, 1, opts.concurrency);
  let ready: Promise<void> | null = null;
  let booted = false;
  const preparePrefix = (prefix: string): Promise<void> => {
    ready ??= (async () => {
      if (!fs.existsSync(path.join(prefix, 'system.reg'))) {
        fs.mkdirSync(prefix, { recursive: true });
        await opts.runner(prefix)('wineboot', ['--init'], { cwd: prefix, timeoutMs: 300_000 });
      }
      await opts.initPrefix(prefix);
      booted = true;
    })();
    return ready;
  };
  return {
    handle: createFfxanimHandler({ ...opts, pool, preparePrefix }),
    installed: (): boolean => opts.tools.installed(),
    /** Copy the tools and boot the prefix before the first take. */
    warm: async (): Promise<void> => {
      await Promise.all([opts.tools.ensure(), preparePrefix(pool.slots[0]!.prefix)]);
    },
    snapshot: () => ({ active: pool.activeCount(), concurrency: opts.concurrency, booted }),
  };
};
