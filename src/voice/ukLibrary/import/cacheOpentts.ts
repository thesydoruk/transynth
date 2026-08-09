import fs from 'node:fs';
import path from 'node:path';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { log } from '../../../logger';
import { downloadFile } from '../../../tools/archiveUtils';
import { ensureDir } from '../../../utils/file';
import { mapWithConcurrency } from '../../../utils/concurrency';
import { ukVoiceCacheOpenttsDir } from './cachePaths';
import { hfDatasetResolveUrl, listHfDatasetParquetPaths } from './hfParquet';
import { OPENTTS_VOICES } from './openttsVoices';

export type OpenttsClipMeta = {
  rowIdx: number;
  duration: number | null;
  transcription: string;
  fileName: string;
};

const manifestPath = (dir: string): string => path.join(dir, 'manifest.jsonl');
const completeMarker = (dir: string): string => path.join(dir, '.cache-complete');
const parquetDir = (dir: string): string => path.join(dir, '_parquet');

const loadManifest = (dir: string): Map<number, OpenttsClipMeta> => {
  const map = new Map<number, OpenttsClipMeta>();
  const file = manifestPath(dir);
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as OpenttsClipMeta;
      map.set(row.rowIdx, row);
    } catch {
      // skip bad line
    }
  }
  return map;
};

const writeManifest = (dir: string, rows: OpenttsClipMeta[]): void => {
  const body = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(manifestPath(dir), body);
};

const audioBytes = (audio: unknown): Buffer | null => {
  if (!audio || typeof audio !== 'object') return null;
  const bytes = (audio as { bytes?: unknown }).bytes;
  if (bytes == null) return null;
  if (typeof bytes === 'string') return Buffer.from(bytes, 'binary');
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (Buffer.isBuffer(bytes)) return bytes;
  return null;
};

const audioPathOf = (audio: unknown): string | null => {
  if (!audio || typeof audio !== 'object') return null;
  const p = (audio as { path?: unknown }).path;
  return typeof p === 'string' && p ? p : null;
};

const transcriptOf = (row: Record<string, unknown>): string => {
  for (const key of ['transcription', 'text', 'sentence'] as const) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const extForClip = (audioPath: string | null, bytes: Buffer): string => {
  if (audioPath) {
    const ext = path.extname(audioPath).toLowerCase();
    if (ext) return ext;
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') return '.ogg';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'RIFF') return '.wav';
  return '.bin';
};

const downloadParquetShards = async (dataset: string, dir: string): Promise<string[]> => {
  const outDir = parquetDir(dir);
  ensureDir(outDir);
  const remotePaths = await listHfDatasetParquetPaths(dataset);
  if (remotePaths.length === 0) {
    throw new Error(`opentts cache ${dataset}: no parquet shards under data/`);
  }
  const localPaths: string[] = [];
  for (const remotePath of remotePaths) {
    const local = path.join(outDir, path.basename(remotePath));
    if (!fs.existsSync(local) || fs.statSync(local).size === 0) {
      log.info(`opentts cache: downloading ${dataset} ${remotePath}`);
      await downloadFile(hfDatasetResolveUrl(dataset, remotePath), local);
    }
    localPaths.push(local);
  }
  return localPaths;
};

const extractParquetShards = async (
  voiceSlug: string,
  shards: string[],
  dir: string,
): Promise<OpenttsClipMeta[]> => {
  const metas: OpenttsClipMeta[] = [];
  let rowIdx = 0;
  for (const shard of shards) {
    log.info(`opentts cache ${voiceSlug}: extracting ${path.basename(shard)}`);
    const file = await asyncBufferFromFile(shard);
    // utf8:false keeps audio BYTE_ARRAY as raw bytes (default utf8 corrupts Ogg/Opus).
    const rows = await parquetReadObjects({ file, compressors, utf8: false });
    for (const row of rows) {
      const rec = row as Record<string, unknown>;
      const bytes = audioBytes(rec.audio);
      if (!bytes || bytes.length === 0) {
        rowIdx += 1;
        continue;
      }
      const transcription = transcriptOf(rec);
      const ext = extForClip(audioPathOf(rec.audio), bytes);
      const fileName = `${rowIdx}${ext}`;
      const abs = path.join(dir, fileName);
      if (!fs.existsSync(abs) || fs.statSync(abs).size !== bytes.length) {
        fs.writeFileSync(abs, bytes);
      }
      const duration =
        typeof rec.duration === 'number' && Number.isFinite(rec.duration) ? rec.duration : null;
      metas.push({ rowIdx, duration, transcription, fileName });
      rowIdx += 1;
    }
  }
  return metas;
};

/** Download HF parquet shards and unpack every clip into the NFS cache. */
export const cacheOpenttsVoice = async (voiceSlug: string, dataset: string): Promise<number> => {
  const dir = ukVoiceCacheOpenttsDir(voiceSlug);
  if (fs.existsSync(completeMarker(dir))) {
    const existing = loadManifest(dir);
    log.info(`opentts cache ready: ${voiceSlug} (${existing.size} clips)`);
    return existing.size;
  }

  ensureDir(dir);
  const shards = await downloadParquetShards(dataset, dir);
  const metas = await extractParquetShards(voiceSlug, shards, dir);
  writeManifest(dir, metas);
  fs.writeFileSync(
    completeMarker(dir),
    JSON.stringify({
      dataset,
      method: 'parquet',
      clips: metas.length,
      at: new Date().toISOString(),
    }),
  );
  log.info(`opentts cache complete: ${voiceSlug} (${metas.length} clips)`);
  return metas.length;
};

/** Cache all five opentts studio corpora in parallel (one parquet each). */
export const cacheAllOpenttsDatasets = async (): Promise<number> => {
  const counts = await mapWithConcurrency(OPENTTS_VOICES, OPENTTS_VOICES.length, async (voice) =>
    cacheOpenttsVoice(voice.slug, voice.dataset),
  );
  return counts.reduce((sum, n) => sum + (n ?? 0), 0);
};

export const listCachedOpenttsClips = (voiceSlug: string): OpenttsClipMeta[] => {
  const dir = ukVoiceCacheOpenttsDir(voiceSlug);
  return [...loadManifest(dir).values()];
};

export const cachedOpenttsClipPath = (voiceSlug: string, fileName: string): string =>
  path.join(ukVoiceCacheOpenttsDir(voiceSlug), fileName);
