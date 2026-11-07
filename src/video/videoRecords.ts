/**
 * A video's phrases as records of the mod the video belongs to.
 *
 * Every transcribed phrase is one record with one source string, so the
 * translation pipeline that exists for mods — TM, LLM, verify, the editor, the
 * glossary, the reference base — applies to narration unchanged. The shape is
 * the one MCM text has: signature `VIDEO`, no FormID, the key in the path
 * (`VIDEO\<file>\<phrase>`), the EDID naming the video and the phrase.
 */
import type { Tx } from '../db';
import { bulkInsertRecordImportRows } from '../import/bulk/recordImport';
import { modImportRecordKey } from '../import/bulk/recordKeys';
import { log } from '../logger';
import { normalizeForHash } from '../utils/textNorm';
import { listVideoSegments, type VideoPhrase } from './segments';
import type { VideoAssetRow } from './types';

export const VIDEO_SIGNATURE = 'VIDEO';

const phraseNo = (idx: number): string => String(idx).padStart(3, '0');

/** `VIDEO\<file>\`: every record of one video starts with it. */
export const videoRecordPathPrefix = (fileName: string): string =>
  `${VIDEO_SIGNATURE}\\${fileName}\\`;

export const videoPhrasePath = (fileName: string, idx: number): string =>
  `${videoRecordPathPrefix(fileName)}${phraseNo(idx)}`;

export const videoPhraseEdid = (fileName: string, idx: number): string =>
  `${fileName.replace(/\.[^.]+$/, '')}#${phraseNo(idx)}`;

/** The video file and phrase index a record path names, or null for another path. */
export const parseVideoPhrasePath = (
  recordPath: string | null | undefined,
): { fileName: string; idx: number } | null => {
  const m = /^VIDEO\\([^\\]+)\\(\d{3,})$/.exec(recordPath ?? '');
  return m ? { fileName: m[1]!, idx: Number(m[2]) } : null;
};

type ExistingString = { path: string; string_id: number; text_norm: string };

export type VideoRecordSync = {
  /** Phrase index → id of its source string. */
  stringIds: Map<number, number>;
  /** What a pruning import must keep: the record keys and string ids of the phrases. */
  keptRecordKeys: Set<string>;
  keptStringIds: Set<number>;
  inserted: number;
  dropped: number;
};

/**
 * Write a video's phrases into the mod and return the string id of each.
 *
 * A phrase whose source text did not change keeps its string, and with it the
 * translation and its review; a changed or new phrase gets a fresh string, and
 * phrases that disappeared take their records with them.
 */
export const writeVideoPhrases = async (
  db: Tx,
  opts: { modId: number; fileName: string; srcLang: string; tgtLang: string },
  phrases: readonly VideoPhrase[],
): Promise<VideoRecordSync> => {
  const prefix = videoRecordPathPrefix(opts.fileName);
  const { rows: existing } = await db.query<ExistingString>(
    `SELECT r.path, s.id AS string_id, s.text_norm
       FROM records r JOIN strings s ON s.record_id = r.id AND s.lang = $3
      WHERE r.mod_id = $1 AND r.signature = $4 AND left(r.path, length($2)) = $2`,
    [opts.modId, prefix, opts.srcLang, VIDEO_SIGNATURE],
  );
  const byPath = new Map(existing.map((row) => [row.path, row]));

  const stringIds = new Map<number, number>();
  const stalePaths: string[] = [];
  const toInsert: VideoPhrase[] = [];
  const wanted = new Set<string>();
  for (const phrase of phrases) {
    const recordPath = videoPhrasePath(opts.fileName, phrase.idx);
    wanted.add(recordPath);
    const old = byPath.get(recordPath);
    if (old && old.text_norm === normalizeForHash(phrase.text)) {
      stringIds.set(phrase.idx, old.string_id);
    } else {
      if (old) stalePaths.push(recordPath);
      toInsert.push(phrase);
    }
  }
  for (const recordPath of byPath.keys()) if (!wanted.has(recordPath)) stalePaths.push(recordPath);

  if (stalePaths.length > 0) {
    await db.query(
      `DELETE FROM records WHERE mod_id = $1 AND signature = $3 AND path = ANY($2::text[])`,
      [opts.modId, stalePaths, VIDEO_SIGNATURE],
    );
  }
  if (toInsert.length > 0) {
    const inserted = await bulkInsertRecordImportRows(
      db,
      opts.modId,
      toInsert.map((phrase) => ({
        signature: VIDEO_SIGNATURE,
        formId: '',
        edid: videoPhraseEdid(opts.fileName, phrase.idx),
        field: videoPhrasePath(opts.fileName, phrase.idx),
        source: phrase.text,
        target: '',
        status: 0,
      })),
      opts.srcLang,
      opts.tgtLang,
      { sourceKind: 'video', provenance: 'video' },
    );
    inserted.forEach((row, i) => stringIds.set(toInsert[i]!.idx, row.stringId));
  }
  const keptRecordKeys = new Set(
    [...stringIds.keys()].map((idx) =>
      modImportRecordKey(VIDEO_SIGNATURE, videoPhrasePath(opts.fileName, idx), ''),
    ),
  );
  return {
    stringIds,
    keptRecordKeys,
    keptStringIds: new Set(stringIds.values()),
    inserted: toInsert.length,
    dropped: stalePaths.length,
  };
};

/**
 * Make the mod's records match the asset's segments and point every segment
 * at its string: after a transcription, after a carry-over, and on every
 * import of the mod (which prunes the records it is not told to keep).
 */
export const syncVideoRecords = async (
  db: Tx,
  asset: Pick<VideoAssetRow, 'id' | 'mod_id' | 'file_name'>,
  srcLang: string,
  tgtLang: string,
): Promise<VideoRecordSync> => {
  const segments = await listVideoSegments(db, asset.id, tgtLang);
  const phrases: VideoPhrase[] = segments.map((seg) => ({
    idx: seg.idx,
    startS: seg.start_s,
    endS: seg.end_s,
    speaker: seg.speaker,
    text: seg.source_text,
  }));
  const sync = await writeVideoPhrases(
    db,
    { modId: asset.mod_id, fileName: asset.file_name, srcLang, tgtLang },
    phrases,
  );
  if (segments.length > 0) {
    await db.query(
      `UPDATE video_segments v SET string_id = u.string_id
         FROM UNNEST($2::int[], $3::int[]) AS u(idx, string_id)
        WHERE v.video_id = $1 AND v.idx = u.idx AND v.string_id IS DISTINCT FROM u.string_id`,
      [asset.id, [...sync.stringIds.keys()], [...sync.stringIds.values()]],
    );
  }
  if (sync.inserted > 0 || sync.dropped > 0) {
    log.info(
      `Video #${asset.id} ${asset.file_name}: ${phrases.length} phrase(s) in mod #${asset.mod_id}, ${sync.inserted} new, ${sync.dropped} dropped`,
    );
  }
  return sync;
};
