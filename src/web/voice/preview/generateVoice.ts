import type { Tx } from '../../../db';
import { loadImportedMod } from '../../../modImport/importedMod';
import { synthesizeDiscoVoiceLine } from '../../../voice/disco/synthesizeDiscoVoiceLine';
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
  speakerKey?: string,
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

  const mod = await loadImportedMod(db, modId);
  if (mod.game === 'disco') {
    return synthesizeDiscoVoiceLine(db, {
      modId,
      pluginPath: resolved.ctx.pluginPath,
      localizeDir,
      formidLower6,
      variant,
      srcLang,
      tgtLang: targetLang,
      force: true,
    });
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
    speakerKey,
  });
};
