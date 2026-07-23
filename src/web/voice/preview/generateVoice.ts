import type { Tx } from '../../../db';
import { synthesizeModVoiceLine } from '../../../voice/synthesizeModVoiceLine';
import { resolveLocalizeDir, resolveModVoiceContext } from './context';
import type { VoiceGenerateLineResult } from './types';

/** Synthesize translation audio for one voice line into `_localize_{hash}/{lang}/`. */
export const generateVoiceTranslationForMod = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
  srcLang: string,
  targetLang: string,
): Promise<VoiceGenerateLineResult> => {
  const resolved = await resolveModVoiceContext(db, modId);
  if (!resolved.ok) return resolved;

  const localizeDir = resolveLocalizeDir(resolved.ctx, resolved.targetLang);
  if (!localizeDir) {
    return {
      ok: false,
      reason: 'no_localize_dir',
      message: 'Mod import localize directory not found',
    };
  }

  return synthesizeModVoiceLine(db, {
    modId,
    packageDir: resolved.ctx.packageDir,
    pluginPath: resolved.ctx.pluginPath,
    localizeDir,
    formidLower6,
    variant,
    srcLang,
    tgtLang: targetLang,
  });
};
