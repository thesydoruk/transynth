import fs from 'node:fs';
import path from 'node:path';
import { log } from '../../../logger';
import { downloadFile } from '../../../tools/archiveUtils';
import { ukVoiceCacheOpenttsDir } from './cachePaths';
import { fetchHfDatasetRows } from './hfRows';
import { OPENTTS_VOICES } from './openttsVoices';

export type OpenttsClipMeta = {
  rowIdx: number;
  duration: number | null;
  transcription: string;
  fileName: string;
};

const manifestPath = (dir: string): string => path.join(dir, 'manifest.jsonl');
const completeMarker = (dir: string): string => path.join(dir, '.cache-complete');

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

const appendManifest = (dir: string, row: OpenttsClipMeta): void => {
  fs.appendFileSync(manifestPath(dir), `${JSON.stringify(row)}\n`);
};

/** Download every opentts clip for one studio voice into the NFS cache. */
export const cacheOpenttsVoice = async (voiceSlug: string, dataset: string): Promise<number> => {
  const dir = ukVoiceCacheOpenttsDir(voiceSlug);
  if (fs.existsSync(completeMarker(dir))) {
    const existing = loadManifest(dir);
    log.info(`opentts cache ready: ${voiceSlug} (${existing.size} clips)`);
    return existing.size;
  }

  const known = loadManifest(dir);
  const pageSize = 100;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  let downloaded = 0;

  while (offset < total) {
    const page = await fetchHfDatasetRows(dataset, offset, pageSize);
    total = page.total;
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      if (known.has(row.rowIdx)) continue;
      const ext =
        row.audioUrl.includes('.opus') || row.audioUrl.includes('audio/ogg')
          ? '.opus'
          : row.audioUrl.includes('.wav')
            ? '.wav'
            : '.bin';
      const fileName = `${row.rowIdx}${ext}`;
      const abs = path.join(dir, fileName);
      if (!fs.existsSync(abs)) {
        await downloadFile(row.audioUrl, abs);
        downloaded += 1;
      }
      const meta: OpenttsClipMeta = {
        rowIdx: row.rowIdx,
        duration: row.duration,
        transcription: row.transcription,
        fileName,
      };
      known.set(row.rowIdx, meta);
      appendManifest(dir, meta);
    }

    offset += pageSize;
    if (offset % 500 === 0 || offset >= total) {
      log.info(`opentts cache ${voiceSlug}: ${known.size}/${total} rows (${downloaded} new)`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  fs.writeFileSync(
    completeMarker(dir),
    JSON.stringify({ dataset, clips: known.size, at: new Date().toISOString() }),
  );
  return known.size;
};

/** Cache all five opentts studio corpora. */
export const cacheAllOpenttsDatasets = async (): Promise<number> => {
  let total = 0;
  for (const voice of OPENTTS_VOICES) {
    total += await cacheOpenttsVoice(voice.slug, voice.dataset);
  }
  return total;
};

export const listCachedOpenttsClips = (voiceSlug: string): OpenttsClipMeta[] => {
  const dir = ukVoiceCacheOpenttsDir(voiceSlug);
  return [...loadManifest(dir).values()];
};

export const cachedOpenttsClipPath = (voiceSlug: string, fileName: string): string =>
  path.join(ukVoiceCacheOpenttsDir(voiceSlug), fileName);
