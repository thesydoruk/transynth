/**
 * Remap Disco PO rows (keyed by msgctxt) onto wav-stem FormIDs.
 */
import {
  discoDialogueMsgctxtKey,
  parseDiscoDialogueMsgctxt,
  parseDiscoPoPathForSignature,
} from '../../import/mod/discoPoPath';
import { voiceTranslationMapKey } from '../loadVoiceTranslations';
import { discoVoiceFormidLower6 } from './discoverDiscoVoiceFiles';
import { getDiscoVoiceTextIndex, type DiscoVoiceTextRef } from './voiceTextIndex';

export const discoVoiceMsgctxtKeyFromPath = (
  recordPath: string,
  edid: string | null,
): string | null => {
  const parsed = parseDiscoPoPathForSignature(recordPath);
  const msgctxt = parsed?.msgctxt ?? edid?.trim() ?? '';
  if (!msgctxt) return null;
  const dialogue = parseDiscoDialogueMsgctxt(msgctxt);
  if (dialogue) return discoDialogueMsgctxtKey(dialogue.field, dialogue.articyId);
  return msgctxt.toLowerCase();
};

export const remapDiscoVoiceRowsByWavStem = <T>(
  extractRoot: string,
  rowsByMsgctxt: Map<string, T>,
  toRow: (stem: string, row: T) => T,
  textIndex?: Map<string, DiscoVoiceTextRef>,
): Map<string, T> => {
  const index = textIndex ?? getDiscoVoiceTextIndex(extractRoot);
  const out = new Map<string, T>();
  for (const [stem, ref] of index) {
    const row = rowsByMsgctxt.get(ref.msgctxtKey) ?? rowsByMsgctxt.get(stem.toLowerCase());
    if (!row) continue;
    const key = voiceTranslationMapKey(discoVoiceFormidLower6(stem), 1);
    if (out.has(key)) continue;
    out.set(key, toRow(stem, row));
  }
  return out;
};
