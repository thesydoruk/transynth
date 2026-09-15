/**
 * Load Disco PO source lines keyed by audio-stem FormID.
 */
import type { Tx } from '../../../db';
import { discoSpokenSignatureSqlValues } from '../import/poSignature';
import {
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
} from '../../../voice/loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';
import type { DiscoVoiceLoadFilter } from './loadVoiceClips';
import { countDiscoVoiceClips } from './persistVoiceClips';
import { discoVoiceMsgctxtKeyFromPath, remapDiscoVoiceRowsByWavStem } from './remapVoiceRows';
import { getDiscoVoiceTextIndex } from './voiceTextIndex';

const loadSourcesFromClips = async (
  db: Tx,
  modId: number,
  srcLang: string,
  filter: DiscoVoiceLoadFilter,
): Promise<Map<string, VoiceSourceDetailRow>> => {
  const { rows } = await db.query<{
    line_key: string;
    wav_stem: string;
    string_id: number;
    source: string;
  }>(
    `SELECT
       c.line_key,
       c.clip_key AS wav_stem,
       s.id AS string_id,
       s.text_raw AS source
     FROM voice_clips c
     JOIN strings s ON s.record_id = c.record_id AND s.lang = $2
     WHERE c.mod_id = $1
       AND c.record_id IS NOT NULL
       AND ($3::text IS NULL OR c.speaker_key = $3)
       AND ($4::text IS NULL OR UPPER(c.line_key) = $4)`,
    [
      modId,
      srcLang,
      filter.speakerKey?.trim() || null,
      filter.lineKey?.trim().toUpperCase() || null,
    ],
  );

  const out = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const source = normalizeVoiceText(row.source);
    if (!source) continue;
    const lineKey = row.line_key.toUpperCase();
    const key = voiceTranslationMapKey(lineKey, 1);
    if (out.has(key)) continue;
    out.set(key, {
      source,
      infoFormidHex: lineKey.padStart(8, '0'),
      stringId: row.string_id,
    });
  }
  return out;
};

const loadSourcesByRemap = async (
  db: Tx,
  modId: number,
  srcLang: string,
  extractRoot?: string | null,
): Promise<Map<string, VoiceSourceDetailRow>> => {
  const { rows } = await db.query<{
    path: string;
    edid: string | null;
    string_id: number;
    source: string;
  }>(
    `SELECT
       r.path,
       r.edid,
       s.id AS string_id,
       s.text_raw AS source
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     WHERE r.mod_id = $1
       AND r.signature = ANY($3::text[])`,
    [modId, srcLang, discoSpokenSignatureSqlValues()],
  );

  const byMsgctxt = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const source = normalizeVoiceText(row.source);
    if (!source) continue;
    const msgctxtKey = discoVoiceMsgctxtKeyFromPath(row.path, row.edid);
    if (!msgctxtKey || byMsgctxt.has(msgctxtKey)) continue;
    const stem = (row.edid ?? '').trim();
    const lineKey = stem ? discoVoiceFormidLower6(stem) : msgctxtKey.slice(0, 12);
    byMsgctxt.set(msgctxtKey, {
      source,
      infoFormidHex: lineKey.padStart(8, '0'),
      stringId: row.string_id,
    });
  }

  if (!extractRoot) {
    const out = new Map<string, VoiceSourceDetailRow>();
    for (const [key, row] of byMsgctxt) {
      out.set(voiceTranslationMapKey(discoVoiceFormidLower6(key), 1), row);
    }
    return out;
  }

  return remapDiscoVoiceRowsByWavStem(
    extractRoot,
    byMsgctxt,
    (stem, row) => ({
      ...row,
      infoFormidHex: discoVoiceFormidLower6(stem).padStart(8, '0'),
    }),
    getDiscoVoiceTextIndex(extractRoot),
  );
};

/** Join spoken PO rows to source strings for the voice editor. */
export const loadDiscoVoiceSources = async (
  db: Tx,
  modId: number,
  srcLang: string,
  extractRoot?: string | null,
  filter: DiscoVoiceLoadFilter = {},
): Promise<Map<string, VoiceSourceDetailRow>> => {
  if ((await countDiscoVoiceClips(db, modId)) > 0) {
    return loadSourcesFromClips(db, modId, srcLang, filter);
  }
  return loadSourcesByRemap(db, modId, srcLang, extractRoot);
};
