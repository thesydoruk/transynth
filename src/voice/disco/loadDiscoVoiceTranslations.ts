/**
 * Join spoken PO translations to Audio/ wav stems.
 */
import type { Tx } from '../../db';
import { discoPoSignatureSqlValues } from '../../import/mod/discoPoSignature';
import { voiceTranslationMapKey, type VoiceTranslationRow } from '../loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';
import { discoVoiceMsgctxtKeyFromPath, remapDiscoVoiceRowsByWavStem } from './remapVoiceRows';

/**
 * Load Disco PO translations keyed by audio-stem FormID (`FORMID:variant`).
 */
export const loadDiscoVoiceTranslations = async (
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
    [modId, srcLang, tgtLang, discoPoSignatureSqlValues()],
  );

  const byMsgctxt = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    const msgctxtKey = discoVoiceMsgctxtKeyFromPath(row.path, row.edid);
    if (!msgctxtKey || byMsgctxt.has(msgctxtKey)) continue;
    const stem = (row.edid ?? '').trim();
    const formidLower6 = stem ? discoVoiceFormidLower6(stem) : '000000000000';
    byMsgctxt.set(msgctxtKey, {
      formidLower6,
      infoFormidHex: formidLower6.padStart(8, '0'),
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
      const formidLower6 = discoVoiceFormidLower6(key);
      out.set(voiceTranslationMapKey(formidLower6, 1), { ...row, formidLower6 });
    }
    return out;
  }

  return remapDiscoVoiceRowsByWavStem(extractRoot, byMsgctxt, (stem, row) => {
    const formidLower6 = discoVoiceFormidLower6(stem);
    return {
      ...row,
      formidLower6,
      infoFormidHex: formidLower6.padStart(8, '0'),
      edid: stem,
    };
  });
};
