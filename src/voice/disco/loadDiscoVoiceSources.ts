/**
 * Load Disco PO source lines keyed by audio-stem FormID (SHA1 lower-6).
 */
import type { Tx } from '../../db';
import { discoPoSignatureSqlValues } from '../../import/mod/discoPoSignature';
import {
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
} from '../loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';

/** Join `records.edid` (audio stem) to source strings for the voice editor. */
export const loadDiscoVoiceSources = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, VoiceSourceDetailRow>> => {
  const { rows } = await db.query<{
    edid: string | null;
    string_id: number;
    source: string;
  }>(
    `SELECT
       r.edid,
       s.id AS string_id,
       s.text_raw AS source
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     WHERE r.mod_id = $1
       AND r.signature = ANY($3::text[])
       AND r.edid IS NOT NULL
       AND BTRIM(r.edid) <> ''`,
    [modId, srcLang, discoPoSignatureSqlValues()],
  );

  const out = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const stem = (row.edid ?? '').trim();
    const source = normalizeVoiceText(row.source);
    if (!stem || !source) continue;
    const formidLower6 = discoVoiceFormidLower6(stem);
    const key = voiceTranslationMapKey(formidLower6, 1);
    if (out.has(key)) continue;
    out.set(key, {
      source,
      infoFormidHex: formidLower6.padStart(8, '0'),
      stringId: row.string_id,
    });
  }
  return out;
};
