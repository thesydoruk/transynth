import type { Tx } from '../../../db';
import { loadImportedMod } from '../../../modImport/importedMod';
import { synthesizeDiscoVoiceLine } from '../../../voice/disco/synthesizeDiscoVoiceLine';
import { synthesizeModVoiceLine } from '../../../voice/synthesizeModVoiceLine';
import { emitVoiceLive } from '../../../voice/voiceLiveEvents';
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

  const speaker = speakerKey?.trim() ?? '';
  const live = speaker ? { modId, speakerKey: speaker, formidLower6, variant } : null;
  if (live) emitVoiceLive({ type: 'line_started', ...live });

  const mod = await loadImportedMod(db, modId);
  try {
    const result =
      mod.game === 'disco'
        ? await synthesizeDiscoVoiceLine(db, {
            modId,
            pluginPath: resolved.ctx.pluginPath,
            localizeDir,
            formidLower6,
            variant,
            srcLang,
            tgtLang: targetLang,
            force: true,
          })
        : await synthesizeModVoiceLine(db, {
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
    if (live) {
      if (result.ok && !result.skipped) emitVoiceLive({ type: 'line_done', ...live });
      else emitVoiceLive({ type: 'line_failed', ...live });
    }
    return result;
  } catch (err) {
    if (live) emitVoiceLive({ type: 'line_failed', ...live });
    throw err;
  }
};
