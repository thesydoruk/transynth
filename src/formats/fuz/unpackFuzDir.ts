import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapWithConcurrency } from '../../utils/concurrency';
import { ensureDir } from '../../utils/file';
import { convertToFo4Wav } from '../../voice/ffmpegAudio';
import { readFuzFile } from './fuz';

export type UnpackFuzDirOptions = {
  /** Folder containing `.fuz` files (non-recursive). */
  srcDir: string;
  /** Output folder (default: `{parent}/{basename}_unpacked`). */
  outDir?: string;
  /** Write `.wav` from extracted `.xwm` via ffmpeg (default: true). */
  wav?: boolean;
  /** Parallel ffmpeg jobs when `wav` is enabled (default: min(8, CPU count)). */
  concurrency?: number;
  /** Overwrite existing extracted files (default: false). */
  force?: boolean;
};

export type UnpackFuzDirResult = {
  srcDir: string;
  outDir: string;
  fuzCount: number;
  extracted: number;
  wavCount: number;
  skipped: number;
  failed: Array<{ file: string; error: string }>;
};

const defaultOutDir = (srcDir: string): string =>
  path.join(path.dirname(srcDir), `${path.basename(srcDir)}_unpacked`);

const listFuzFiles = (srcDir: string): string[] =>
  fs
    .readdirSync(srcDir)
    .filter((name) => name.toLowerCase().endsWith('.fuz'))
    .sort();

/** Unpack `.fuz` containers into `.lip`, `.xwm`, and optionally `.wav` files. */
export const unpackFuzDir = async (opts: UnpackFuzDirOptions): Promise<UnpackFuzDirResult> => {
  const srcDir = path.resolve(opts.srcDir);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error(`Source directory not found: ${srcDir}`);
  }

  const outDir = path.resolve(opts.outDir ?? defaultOutDir(srcDir));
  const wav = opts.wav ?? true;
  const force = opts.force ?? false;
  const concurrency = opts.concurrency ?? Math.min(8, os.cpus().length || 4);

  ensureDir(outDir);

  const fuzFiles = listFuzFiles(srcDir);
  const failed: Array<{ file: string; error: string }> = [];
  let extracted = 0;
  let skipped = 0;

  const wavJobs: Array<{ base: string; xwmPath: string; wavPath: string }> = [];

  for (const file of fuzFiles) {
    const base = file.replace(/\.fuz$/i, '');
    const lipPath = path.join(outDir, `${base}.lip`);
    const xwmPath = path.join(outDir, `${base}.xwm`);
    const wavPath = path.join(outDir, `${base}.wav`);

    const lipExists = fs.existsSync(lipPath);
    const xwmExists = fs.existsSync(xwmPath);
    if (!force && lipExists && xwmExists) {
      skipped++;
      if (wav && (!fs.existsSync(wavPath) || force)) {
        wavJobs.push({ base, xwmPath, wavPath });
      }
      continue;
    }

    try {
      const { lip, xwm } = readFuzFile(path.join(srcDir, file));
      fs.writeFileSync(lipPath, lip);
      fs.writeFileSync(xwmPath, xwm);
      extracted++;
      if (wav) wavJobs.push({ base, xwmPath, wavPath });
    } catch (err) {
      failed.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let wavCount = 0;
  if (wav && wavJobs.length > 0) {
    await mapWithConcurrency(wavJobs, concurrency, async (job) => {
      if (!force && fs.existsSync(job.wavPath)) {
        wavCount++;
        return;
      }
      try {
        await convertToFo4Wav(job.xwmPath, job.wavPath);
        wavCount++;
      } catch (err) {
        failed.push({
          file: `${job.base}.xwm`,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  return {
    srcDir,
    outDir,
    fuzCount: fuzFiles.length,
    extracted,
    wavCount,
    skipped,
    failed,
  };
};
