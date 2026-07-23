import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractXwmFromFuzFile } from '../../../formats/fuz';
import { log } from '../../../logger';
import { sha1Hex, sha1HexFile } from '../../../utils/hash';
import { ensureDir } from '../../../utils/file';
import { convertToFo4Wav } from '../../../voice/ffmpegAudio';

export const cacheKeyForSource = async (sourcePath: string): Promise<string> => {
  const stat = fs.statSync(sourcePath);
  return sha1Hex(`${sourcePath}|${stat.mtimeMs}|${stat.size}`);
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
  const digest = await cacheKeyForSource(sourcePath);
  const cachedWav = path.join(cacheDir, `${digest}.wav`);

  if (fs.existsSync(cachedWav)) {
    const sourceDigest = await sha1HexFile(sourcePath);
    const markerPath = path.join(cacheDir, `${digest}.source`);
    const marker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8').trim() : '';
    if (marker === sourceDigest) {
      return { ok: true, wavPath: cachedWav };
    }
  }

  ensureDir(cacheDir);
  try {
    await convertAudioToPreviewWav(sourcePath, cachedWav);
    const sourceDigest = await sha1HexFile(sourcePath);
    fs.writeFileSync(path.join(cacheDir, `${digest}.source`), sourceDigest);
    return { ok: true, wavPath: cachedWav };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Voice preview convert failed ${logLabel}: ${message}`);
    return { ok: false, message };
  }
};
