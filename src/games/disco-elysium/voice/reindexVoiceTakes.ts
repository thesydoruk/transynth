/**
 * The database side of the Disco take index.
 *
 * Writing ASR-aligned wav↔lockit pairs onto `voice_clips` rows that have no
 * text: only rows the import left unmatched are touched, since a clip the
 * count-zip already paired is authoritative. `game_data.match` records that the
 * pairing was heard rather than counted, together with its score, so a weak
 * match stays visible instead of looking like an exact one.
 *
 * {@link reindexDiscoVoiceTakes} is the same work for a mod imported under
 * older rules, driven from the plugin contract instead of the import job.
 */
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { log } from '../../../logger';
import type { VoiceReindexRequest, VoiceReindexResult } from '../../contract';
import {
  alignDiscoTakesByAsr,
  type AlignDiscoTakesOptions,
  type DiscoAlignedRef,
} from './alignTakesByAsr';
import {
  loadDiscoSpokenRecordIdsByMsgctxt,
  persistDiscoVoiceClips,
  countDiscoVoiceClips,
} from './persistVoiceClips';
import { persistDiscoSpeakers } from '../import/speakers';
import { loadDiscoVoiceClipSummaries } from './loadVoiceClips';
import { resolveDiscoVoiceExtractRoot } from './discoverDiscoVoiceFiles';
import { invalidateDiscoVoiceTextIndex } from './voiceTextIndex';
import { invalidateDiscoSpokenPoLines } from './spokenPoLines';

export type AlignDiscoClipsResult = {
  /** Clips that had no text before this ran. */
  unmatched: number;
  /** Clips this run gave text to. */
  matched: number;
  groups: number;
  transcribed: number;
  transcribeFailures: number;
};

const loadUnmatchedClipKeys = async (db: Tx, modId: number): Promise<Set<string>> => {
  const { rows } = await db.query<{ clip_key: string }>(
    `SELECT clip_key FROM voice_clips WHERE mod_id = $1 AND record_id IS NULL`,
    [modId],
  );
  return new Set(rows.map((row) => row.clip_key));
};

type ClipUpdate = {
  clipKey: string;
  recordId: number;
  msgctxtKey: string;
  articyId: string;
  field: string;
  score: number;
};

const updateClipChunk = async (db: Tx, modId: number, slice: ClipUpdate[]): Promise<void> => {
  await db.query(
    `UPDATE voice_clips c
        SET record_id = u.record_id,
            game_data = COALESCE(c.game_data, '{}'::jsonb) || jsonb_build_object(
              'msgctxt_key', u.msgctxt_key,
              'articy_id', u.articy_id,
              'field', u.field,
              'match', jsonb_build_object('by', 'asr', 'score', u.score))
       FROM UNNEST($2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::float8[])
         AS u(clip_key, record_id, msgctxt_key, articy_id, field, score)
      WHERE c.mod_id = $1
        AND c.clip_key = u.clip_key
        AND c.record_id IS NULL`,
    [
      modId,
      slice.map((row) => row.clipKey),
      slice.map((row) => row.recordId),
      slice.map((row) => row.msgctxtKey),
      slice.map((row) => row.articyId),
      slice.map((row) => row.field),
      slice.map((row) => row.score),
    ],
  );
};

const toUpdate = (
  clipKey: string,
  ref: DiscoAlignedRef,
  recordIds: Map<string, number>,
): ClipUpdate | null => {
  const recordId = recordIds.get(ref.msgctxtKey);
  if (recordId == null) return null;
  return {
    clipKey,
    recordId,
    msgctxtKey: ref.msgctxtKey,
    articyId: ref.articyId,
    field: ref.field,
    score: Number(ref.score.toFixed(3)),
  };
};

/**
 * Give text to the Disco clips the import could not pair.
 *
 * Safe to re-run: matched clips are skipped, and audio-intel answers come from
 * its disk cache the second time around.
 */
export const alignDiscoVoiceClips = async (
  db: Tx,
  modId: number,
  extractRoot: string,
  options: AlignDiscoTakesOptions = {},
): Promise<AlignDiscoClipsResult> => {
  const unmatched = await loadUnmatchedClipKeys(db, modId);
  const result: AlignDiscoClipsResult = {
    unmatched: unmatched.size,
    matched: 0,
    groups: 0,
    transcribed: 0,
    transcribeFailures: 0,
  };
  if (unmatched.size === 0) return result;

  const aligned = await alignDiscoTakesByAsr(extractRoot, options);
  result.groups = aligned.groups;
  result.transcribed = aligned.transcribed;
  result.transcribeFailures = aligned.transcribeFailures;
  if (aligned.refs.size === 0) return result;

  const recordIds = await loadDiscoSpokenRecordIdsByMsgctxt(db, modId);
  const updates: ClipUpdate[] = [];
  for (const [stem, ref] of aligned.refs) {
    if (!unmatched.has(stem)) continue;
    const update = toUpdate(stem, ref, recordIds);
    if (update) updates.push(update);
  }
  if (updates.length === 0) return result;

  const chunkSize = Math.max(1, CONFIG.dbChunkSize);
  for (let i = 0; i < updates.length; i += chunkSize) {
    await updateClipChunk(db, modId, updates.slice(i, i + chunkSize));
  }
  result.matched = updates.length;
  log.info(
    `Disco voice alignment: mod ${modId} matched ${result.matched}/${result.unmatched} unmatched clip(s) across ${result.groups} conversation(s)`,
  );
  return result;
};

/**
 * Re-derive a already-imported mod's take index from the pack.
 *
 * `rebuild` re-reads `Audio/`, which is what drops the soundtrack entries an
 * older import kept and renames speakers after the current stem rules;
 * `matchByAudio` then listens to whatever still has no line. Both default on,
 * and either half alone is a valid repair.
 */
export const reindexDiscoVoiceTakes = async (
  db: Tx,
  request: VoiceReindexRequest,
): Promise<VoiceReindexResult> => {
  const extractRoot = resolveDiscoVoiceExtractRoot(request.pluginPath);
  if (!extractRoot) {
    throw new Error(`Disco pack not found on disk for mod ${request.modId}`);
  }
  invalidateDiscoVoiceTextIndex(extractRoot);
  invalidateDiscoSpokenPoLines();

  const result: VoiceReindexResult = {
    takes: 0,
    speakers: 0,
    unmatched: 0,
    matched: 0,
    transcribed: 0,
  };

  if (request.rebuild !== false) {
    result.takes = await persistDiscoVoiceClips(db, request.modId, extractRoot);
    // Speakers are named after the same stems, soundtrack and all.
    const summaries = await loadDiscoVoiceClipSummaries(db, request.modId);
    result.speakers = await persistDiscoSpeakers(
      db,
      request.modId,
      summaries.map((clip) => clip.wavStem),
    );
  } else {
    result.takes = await countDiscoVoiceClips(db, request.modId);
  }

  if (request.matchByAudio === false) return result;

  const aligned = await alignDiscoVoiceClips(db, request.modId, extractRoot, {
    onProgress: request.onProgress,
  });
  result.unmatched = aligned.unmatched;
  result.matched = aligned.matched;
  result.transcribed = aligned.transcribed;
  return result;
};
