import type { Tx } from '../../../db';
import {
  loadVoiceTranslations,
  lookupVoiceTranslation,
  voiceTranslationMapKey,
} from '../../../voice/loadVoiceTranslations';
import { loadVoiceSynthesisVersionMap } from '../../../voice/voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../../../voice/voiceTtsPayloadVersion';
import { prepareVoiceTtsText } from '../../../voice/prepareVoiceTtsText';
import { effectiveStressedTranslation } from '../../../voice/stressedTranslation';
import { loadImportedMod } from '../../../modImport/importedMod';
import { resolveModVoiceContext } from './context';
import { discoverVoiceEntries } from './voiceEntries';
import { buildTranslationAudioSet, hasTranslationAudio } from './translationAudioIndex';
import type { VoiceAvailabilityResult } from './types';

/**
 * Which voice lines of a mod can be played, keyed by `FORMID6:variant`.
 *
 * Thinner than the voice editor speaker/line lists: the dialogs editor only
 * needs to know whether a play button belongs on a line, so this skips
 * resolving speakers, source text, translations, and inherited audio. A mod
 * without any voice assets is not an error here — it simply has no keys.
 */
export const listVoiceAvailabilityForMod = async (
  db: Tx,
  modId: number,
  targetLang?: string,
): Promise<VoiceAvailabilityResult> => {
  const resolved = await resolveModVoiceContext(db, modId, targetLang);
  if (!resolved.ok) return resolved;

  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, resolved.targetLang);
  const mod = await loadImportedMod(db, modId);
  const translations = await loadVoiceTranslations(db, modId, mod.srcLang, resolved.targetLang);
  const translationAudio = buildTranslationAudioSet(resolved.ctx.localizeDir);
  const source: string[] = [];
  const translation: string[] = [];
  const stale: string[] = [];

  for (const entry of discoverVoiceEntries(resolved.ctx)) {
    const key = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    source.push(key);

    if (!hasTranslationAudio(translationAudio, entry.formidLower6, entry.variant)) continue;

    translation.push(key);

    const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
    if (!row) continue;
    const prepared = prepareVoiceTtsText({
      lineSource: row.source,
      translation: row.translation,
      stressedTranslation: effectiveStressedTranslation(row),
      speakerSource: row.source,
      edid: row.edid,
    });
    if (prepared.action !== 'synthesize') continue;
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, resolved.targetLang);
    const storedVersion = storedVersions.get(key);
    if (!isVoiceSynthesisCurrent(storedVersion, payloadVersion, true)) {
      stale.push(key);
    }
  }

  return { ok: true, targetLang: resolved.targetLang, source, translation, stale };
};
