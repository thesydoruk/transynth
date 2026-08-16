/**
 * Load Disco PO source lines keyed by audio-stem FormID.
 */
import type { Tx } from '../../db';
import { discoPoSignatureSqlValues } from '../../import/mod/discoPoSignature';
import {
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
} from '../loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';
import { discoVoiceMsgctxtKeyFromPath, remapDiscoVoiceRowsByWavStem } from './remapVoiceRows';

/** Join spoken PO rows to source strings for the voice editor. */
export const loadDiscoVoiceSources = async (
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
    [modId, srcLang, discoPoSignatureSqlValues()],
  );

  const byMsgctxt = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const source = normalizeVoiceText(row.source);
    if (!source) continue;
    const msgctxtKey = discoVoiceMsgctxtKeyFromPath(row.path, row.edid);
    if (!msgctxtKey || byMsgctxt.has(msgctxtKey)) continue;
    const stem = (row.edid ?? '').trim();
    const formidLower6 = stem ? discoVoiceFormidLower6(stem) : msgctxtKey.slice(0, 12);
    byMsgctxt.set(msgctxtKey, {
      source,
      infoFormidHex: formidLower6.padStart(8, '0'),
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

  return remapDiscoVoiceRowsByWavStem(extractRoot, byMsgctxt, (stem, row) => ({
    ...row,
    infoFormidHex: discoVoiceFormidLower6(stem).padStart(8, '0'),
  }));
};
