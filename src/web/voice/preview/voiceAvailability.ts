import type { Tx } from '../../../db';
import { resolveVoiceRootRel } from '../../../voice/discoverVoiceFiles';
import {
  loadVoiceSourcesDetailed,
  loadVoiceTranslations,
  lookupVoiceTranslation,
  voiceTranslationMapKey,
} from '../../../voice/loadVoiceTranslations';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import {
  loadVoiceSynthesisVersionMap,
  lookupVoiceSynthesisVersion,
} from '../../../voice/voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../../../voice/voiceTtsPayloadVersion';
import {
  prepareVoiceTtsText,
  resolveVoiceLineSkipReason,
  type VoiceTtsSkipReason,
} from '../../../voice/prepareVoiceTtsText';
import { loadImportedMod } from '../../../modImport/importedMod';
import { resolveModVoiceContext } from './context';
import { discoverVoiceEntries } from './voiceEntries';
import { buildTranslationAudioSet, hasTranslationAudioForEntry } from './translationAudioIndex';
import type { VoiceAvailabilityResult } from './types';

/**
 * Which voice lines of a mod can be played, keyed by `FORMID6:variant`.
 *
 * Thinner than the voice editor speaker/line lists: the dialogs editor only
 * needs playable keys plus TTS skip reasons. Speakers and inherited audio
 * are not resolved. A mod without any voice assets is not an error here.
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
  const sources = await loadVoiceSourcesDetailed(db, modId, mod.srcLang);
  const translationAudio = buildTranslationAudioSet(resolved.ctx.localizeDir);
  const voiceRootRel = resolveVoiceRootRel(resolved.ctx.pluginRel);
  const source: string[] = [];
  const translation: string[] = [];
  const stale: string[] = [];
  const skipReasons: Record<string, VoiceTtsSkipReason> = {};

  for (const entry of discoverVoiceEntries(resolved.ctx)) {
    const key = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    source.push(key);
    const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
    const skipReason = resolveVoiceLineSkipReason(
      sources.get(key)?.source ?? row?.source,
      row?.translation ?? '',
      row?.edid,
    );
    if (skipReason) skipReasons[key] = skipReason;

    if (!hasTranslationAudioForEntry(translationAudio, entry)) continue;

    translation.push(key);

    if (!row) continue;
    const prepared = prepareVoiceTtsText({
      lineSource: row.source,
      translation: row.translation,
      speakerSource: row.source,
      edid: row.edid,
    });
    if (prepared.action !== 'synthesize') continue;
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, resolved.targetLang);
    const storedVersion = lookupVoiceSynthesisVersion(
      storedVersions,
      voiceSpeakerKey(entry, voiceRootRel),
      entry.formidLower6,
      entry.variant,
    );
    if (!isVoiceSynthesisCurrent(storedVersion, payloadVersion, true)) {
      stale.push(key);
    }
  }

  return { ok: true, targetLang: resolved.targetLang, source, translation, stale, skipReasons };
};
