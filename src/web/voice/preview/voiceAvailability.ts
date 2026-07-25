import fs from 'node:fs';
import type { Tx } from '../../../db';
import { voiceTranslationMapKey } from '../../../voice/loadVoiceTranslations';
import { resolveLocalizedVoiceAbsPath } from '../../../voice/synthesizeModVoiceLine';
import { resolveModVoiceContext } from './context';
import { discoverVoiceEntries } from './voiceEntries';
import type { VoiceAvailabilityResult } from './types';

/**
 * Which voice lines of a mod can be played, keyed by `FORMID6:variant`.
 *
 * Deliberately thinner than {@link listVoiceLinesForMod}: the dialogs editor
 * only needs to know whether a play button belongs on a line, so this skips
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

  const source: string[] = [];
  const translation: string[] = [];

  for (const entry of discoverVoiceEntries(resolved.ctx)) {
    const key = voiceTranslationMapKey(entry.formidLower6, entry.variant);
    source.push(key);

    const localized = resolveLocalizedVoiceAbsPath(resolved.ctx.localizeDir, entry);
    if (localized && fs.existsSync(localized)) translation.push(key);
  }

  return { ok: true, targetLang: resolved.targetLang, source, translation };
};
