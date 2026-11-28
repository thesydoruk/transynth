import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractXwmFromFuzFile } from '../../../formats/fuz';
import { log } from '../../../logger';
import { sha1Hex, sha1HexFile } from '../../../utils/hash';
import { ensureDir } from '../../../utils/file';
import { convertToFo4Wav } from '../../../voice/ffmpegAudio';
import { decodeWemTakeToWav } from '../../../voice/wemTakeAudio';

/** Rate of the browser copy of a `.wem` take; Wwise voice audio is 48 kHz or below. */
const WEM_PREVIEW_SAMPLE_RATE = 48000;

const cacheKeyForSource = (sourcePath: string): string => {
  const stat = fs.statSync(sourcePath);
  return sha1Hex(`${sourcePath}|${stat.mtimeMs}|${stat.size}`);
};

/** Where the browser copy of `sourcePath`, as it is on disk now, is cached in `cacheDir`. */
export const cachedPreviewWavPath = (sourcePath: string, cacheDir: string): string =>
  path.join(cacheDir, `${cacheKeyForSource(sourcePath)}.wav`);

const sourceMarkerPath = (cachedWav: string): string => cachedWav.replace(/\.wav$/, '.source');

/**
 * Drop the browser copy of `sourcePath` from `cacheDir`. The key is read from
 * the file, so call this before the file itself is deleted. A missing source
 * or copy is not an error.
 */
export const removeCachedPreviewWav = (sourcePath: string, cacheDir: string): void => {
  if (!fs.existsSync(sourcePath)) return;
  const cachedWav = cachedPreviewWavPath(sourcePath, cacheDir);
  fs.rmSync(cachedWav, { force: true });
  fs.rmSync(sourceMarkerPath(cachedWav), { force: true });
};

export const convertAudioToPreviewWav = async (
  sourcePath: string,
  destWav: string,
): Promise<void> => {
  const ext = path.extname(sourcePath).toLowerCase();
  if (ext === '.wav') {
    await convertToFo4Wav(sourcePath, destWav);
    return;
  }
  if (ext === '.wem') {
    await decodeWemTakeToWav(sourcePath, destWav, WEM_PREVIEW_SAMPLE_RATE);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-preview-'));
  try {
    let ffmpegInput = sourcePath;
    if (ext === '.fuz') {
      const xwmPath = path.join(tempDir, 'audio.xwm');
      fs.writeFileSync(xwmPath, extractXwmFromFuzFile(sourcePath));
      ffmpegInput = xwmPath;
    }
    await convertToFo4Wav(ffmpegInput, destWav);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

export const getOrCreateCachedPreviewWav = async (
  sourcePath: string,
  cacheDir: string,
  logLabel: string,
): Promise<{ ok: true; wavPath: string } | { ok: false; message: string }> => {
  const cachedWav = cachedPreviewWavPath(sourcePath, cacheDir);
  const markerPath = sourceMarkerPath(cachedWav);

  if (fs.existsSync(cachedWav)) {
    const sourceDigest = await sha1HexFile(sourcePath);
    const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
    if (marker === sourceDigest) {
      return { ok: true, wavPath: cachedWav };
    }
  }

  ensureDir(cacheDir);
  try {
    await convertAudioToPreviewWav(sourcePath, cachedWav);
    const sourceDigest = await sha1HexFile(sourcePath);
    fs.writeFileSync(markerPath, sourceDigest);
    return { ok: true, wavPath: cachedWav };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Voice preview convert failed ${logLabel}: ${message}`);
    return { ok: false, message };
  }
};
