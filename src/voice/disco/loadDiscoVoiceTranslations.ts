/**
 * Load Disco PO translations keyed like Bethesda voice maps (`FORMID6:variant`).
 */
import type { Tx } from '../../db';
import { voiceTranslationMapKey, type VoiceTranslationRow } from '../loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';

/**
 * Join `records.edid` (audio stem / msgctxt) to translated PO strings.
 */
export const loadDiscoVoiceTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
): Promise<Map<string, VoiceTranslationRow>> => {
  const { rows } = await db.query<{
    edid: string | null;
    string_id: number;
    translation_id: number | null;
    status: string | null;
    translation: string;
    source: string;
  }>(
    `SELECT
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
       AND r.signature = 'PO'
       AND r.edid IS NOT NULL
       AND BTRIM(r.edid) <> ''
       AND t.text IS NOT NULL
       AND BTRIM(t.text) <> ''`,
    [modId, srcLang, tgtLang],
  );

  const out = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    const stem = (row.edid ?? '').trim();
    if (!stem) continue;
    const formidLower6 = discoVoiceFormidLower6(stem);
    const key = voiceTranslationMapKey(formidLower6, 1);
    // Prefer the first non-empty translation if duplicates share an edid.
    if (out.has(key)) continue;
    out.set(key, {
      formidLower6,
      infoFormidHex: formidLower6.padStart(8, '0'),
      voiceVariant: 1,
      stringId: row.string_id,
      translationId: row.translation_id,
      status: row.status,
      translation: row.translation,
      source: row.source,
      edid: stem,
    });
  }
  return out;
};
