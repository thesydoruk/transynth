import fs from 'node:fs';
import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { upsertUkVoiceLibraryRow } from '../db';
import { ukVoiceAudioAbsPath, ukVoiceAudioRelPath, ukVoiceSourceDir } from '../paths';
import type { UkVoiceLibraryRow } from '../types';
import { downloadAndNormalizeReferenceClip } from './downloadClip';
import { fetchHfDatasetRows } from './hfRows';

/** speech-uk mirror of Common Voice 22 Ukrainian validated clips (CC0). */
const CV_DATASET = 'speech-uk/cv22-opus';

const MIN_DUR = 3.5;
const MAX_DUR = 10;
const PAGE = 100;
/** Skip nearby rows — mirror has no speaker_id, so spacing reduces same-speaker collisions. */
const MIN_ROW_GAP = 80;

export type ImportCommonVoiceOptions = {
  /** Max unique clips to keep (default 700). */
  maxVoices?: number;
  /** Max HF rows to scan (default 80_000). */
  maxScanRows?: number;
};

const loadExistingCvRowIdx = async (db: Tx): Promise<number[]> => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM uk_voice_library WHERE source = 'common_voice'`,
  );
  const idxs: number[] = [];
  for (const row of rows) {
    const match = /^cv:(\d+)$/.exec(row.id);
    if (match) idxs.push(Number(match[1]));
  }
  return idxs.sort((a, b) => a - b);
};

/** Import sparsely sampled Common Voice UA clips as distinct library voices. */
export const importCommonVoiceVoices = async (
  db: Tx,
  options: ImportCommonVoiceOptions = {},
): Promise<number> => {
  const maxVoices = options.maxVoices ?? 700;
  const maxScanRows = options.maxScanRows ?? 80_000;
  ukVoiceSourceDir('common_voice');

  const existingIdx = await loadExistingCvRowIdx(db);
  let imported = existingIdx.length;
  let lastKeptRow = existingIdx.length > 0 ? existingIdx[existingIdx.length - 1]! : -MIN_ROW_GAP;
  let offset = Math.max(0, lastKeptRow - (lastKeptRow % PAGE));
  let total = Number.POSITIVE_INFINITY;

  if (imported >= maxVoices) {
    log.info(`common_voice: already have ${imported} clip(s)`);
    return imported;
  }

  log.info(`common_voice: resuming with ${imported}/${maxVoices} (offset=${offset})`);

  while (imported < maxVoices && offset < maxScanRows && offset < total) {
    const page = await fetchHfDatasetRows(CV_DATASET, offset, PAGE);
    total = page.total;
    if (page.rows.length === 0) break;

    for (const row of page.rows) {
      if (imported >= maxVoices) break;
      if (row.duration == null || row.duration < MIN_DUR || row.duration > MAX_DUR) continue;
      if (row.rowIdx - lastKeptRow < MIN_ROW_GAP) continue;

      const id = `cv:${row.rowIdx}`;
      const fileName = `cv_${row.rowIdx}.wav`;
      const rel = ukVoiceAudioRelPath('common_voice', fileName);
      const abs = ukVoiceAudioAbsPath(rel);

      try {
        if (!fs.existsSync(abs)) {
          await downloadAndNormalizeReferenceClip(row.audioUrl, abs);
        }
      } catch (err) {
        log.warn(
          `common_voice: skip row ${row.rowIdx}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      const libraryRow: UkVoiceLibraryRow = {
        id,
        source: 'common_voice',
        displayName: `CV #${row.rowIdx}`,
        description: 'Mozilla Common Voice Ukrainian (validated, CC0) via speech-uk/cv22-opus.',
        gender: 'unknown',
        audioRelPath: rel,
        transcript: row.transcription,
        license: 'CC0',
        durationSec: row.duration,
        meta: { dataset: CV_DATASET, rowIdx: row.rowIdx },
      };
      await upsertUkVoiceLibraryRow(db, libraryRow);
      lastKeptRow = row.rowIdx;
      imported += 1;
      if (imported % 25 === 0) {
        log.info(`common_voice: imported ${imported}/${maxVoices}`);
      }
    }

    offset += PAGE;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  log.info(`common_voice: imported ${imported} clip(s)`);
  return imported;
};
