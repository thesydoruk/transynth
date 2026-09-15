import type { Tx } from '../../../db';
import { gamePlugin } from '../../../games/registry';
import { loadImportedMod } from '../../../modImport/importedMod';
import { emitVoiceLive } from '../../../voice/voiceLiveEvents';
import { resolveLocalizeDir, resolveModVoiceContext } from './context';
import type { VoiceGenerateLineResult } from './types';

/** Synthesize translation audio for one voice line into `_localize_{hash}/{lang}/`. */
export const generateVoiceTranslationForMod = async (
  db: Tx,
  modId: number,
  lineKey: string,
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
  const live = speaker ? { modId, speakerKey: speaker, lineKey, variant } : null;
  if (live) emitVoiceLive({ type: 'line_started', ...live });

  const mod = await loadImportedMod(db, modId);
  const voice = gamePlugin(mod.game).voice;
  if (!voice) {
    return { ok: false, reason: 'no_localize_dir', message: 'This game has no voice support' };
  }

  try {
    const result = await voice.synthesizeLine(db, {
      modId,
      packageDir: resolved.ctx.packageDir,
      pluginPath: resolved.ctx.pluginPath,
      localizeDir,
      lineKey,
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
