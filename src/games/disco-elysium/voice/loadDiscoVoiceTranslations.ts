/**
 * Join spoken PO translations to Audio/ wav stems.
 */
import type { Tx } from '../../../db';
import { discoSpokenSignatureSqlValues } from '../import/poSignature';
import {
  voiceTranslationMapKey,
  type VoiceTranslationRow,
} from '../../../voice/loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';
import type { DiscoVoiceLoadFilter } from './loadVoiceClips';
import { countDiscoVoiceClips } from './persistVoiceClips';
import { discoVoiceMsgctxtKeyFromPath, remapDiscoVoiceRowsByWavStem } from './remapVoiceRows';
import { getDiscoVoiceTextIndex } from './voiceTextIndex';

const loadTranslationsFromClips = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
  filter: DiscoVoiceLoadFilter,
): Promise<Map<string, VoiceTranslationRow>> => {
  const { rows } = await db.query<{
    line_key: string;
    wav_stem: string;
    string_id: number;
    translation_id: number | null;
    status: string | null;
    translation: string;
    source: string;
  }>(
    `SELECT
       c.line_key,
       c.clip_key AS wav_stem,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.status,
       t.text AS translation
     FROM voice_clips c
     JOIN strings s ON s.record_id = c.record_id AND s.lang = $2
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE c.mod_id = $1
       AND c.record_id IS NOT NULL
       AND t.text IS NOT NULL
       AND BTRIM(t.text) <> ''
       AND ($4::text IS NULL OR c.speaker_key = $4)
       AND ($5::text IS NULL OR UPPER(c.line_key) = $5)`,
    [
      modId,
      srcLang,
      tgtLang,
      filter.speakerKey?.trim() || null,
      filter.lineKey?.trim().toUpperCase() || null,
    ],
  );

  const out = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    const lineKey = row.line_key.toUpperCase();
    const key = voiceTranslationMapKey(lineKey, 1);
    if (out.has(key)) continue;
    out.set(key, {
      lineKey,
      infoFormidHex: lineKey.padStart(8, '0'),
      voiceVariant: 1,
      stringId: row.string_id,
      translationId: row.translation_id,
      status: row.status,
      translation: row.translation,
      source: row.source,
      edid: row.wav_stem,
    });
  }
  return out;
};

const loadTranslationsByRemap = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
  extractRoot?: string | null,
): Promise<Map<string, VoiceTranslationRow>> => {
  const { rows } = await db.query<{
    path: string;
    edid: string | null;
    string_id: number;
    translation_id: number | null;
    status: string | null;
    translation: string;
    source: string;
  }>(
    `SELECT
       r.path,
       r.edid,
       s.id AS string_id,
       s.text_raw AS source,
       t.id AS translation_id,
       t.status,
       t.text AS translation
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1
       AND r.signature = ANY($4::text[])
       AND t.text IS NOT NULL
       AND BTRIM(t.text) <> ''`,
    [modId, srcLang, tgtLang, discoSpokenSignatureSqlValues()],
  );

  const byMsgctxt = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    const msgctxtKey = discoVoiceMsgctxtKeyFromPath(row.path, row.edid);
    if (!msgctxtKey || byMsgctxt.has(msgctxtKey)) continue;
    const stem = (row.edid ?? '').trim();
    const lineKey = stem ? discoVoiceFormidLower6(stem) : '000000000000';
    byMsgctxt.set(msgctxtKey, {
      lineKey,
      infoFormidHex: lineKey.padStart(8, '0'),
      voiceVariant: 1,
      stringId: row.string_id,
      translationId: row.translation_id,
      status: row.status,
      translation: row.translation,
      source: row.source,
      edid: stem || null,
    });
  }

  if (!extractRoot) {
    const out = new Map<string, VoiceTranslationRow>();
    for (const [key, row] of byMsgctxt) {
      const lineKey = discoVoiceFormidLower6(key);
      out.set(voiceTranslationMapKey(lineKey, 1), { ...row, lineKey });
    }
    return out;
  }

  return remapDiscoVoiceRowsByWavStem(
    extractRoot,
    byMsgctxt,
    (stem, row) => {
      const lineKey = discoVoiceFormidLower6(stem);
      return {
        ...row,
        lineKey,
        infoFormidHex: lineKey.padStart(8, '0'),
        edid: stem,
      };
    },
    getDiscoVoiceTextIndex(extractRoot),
  );
};

/**
 * Load Disco PO translations keyed by audio-stem FormID (`FORMID:variant`).
 */
export const loadDiscoVoiceTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
  extractRoot?: string | null,
  filter: DiscoVoiceLoadFilter = {},
): Promise<Map<string, VoiceTranslationRow>> => {
  if ((await countDiscoVoiceClips(db, modId)) > 0) {
    return loadTranslationsFromClips(db, modId, srcLang, tgtLang, filter);
  }
  return loadTranslationsByRemap(db, modId, srcLang, tgtLang, extractRoot);
};
