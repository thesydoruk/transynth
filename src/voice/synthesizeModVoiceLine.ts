import fs from 'node:fs';
import type { Tx } from '../db';
import { toDiskPath } from '../modImport';
import { recordVoiceTake } from './referenceVoiceTakeHooks';
import {
  synthesizeModVoiceLineBuffers,
  type SynthesizeModVoiceLineOptions,
} from './synthesizeModVoiceLineBuffers';
import { FUZ_TAKES } from './takeFormat';
import { takeOnDisk, writeVoiceTake, writeVoiceTakeIfChanged } from './takeSidecars';
import { loadVoiceSynthesisVersion, speakerKeyFromVoiceRelPath } from './voiceSynthesisState';
import { isVoiceSynthesisCurrent } from './voiceTtsPayloadVersion';
import { originFromVoiceRelPath } from './voiceOrigin';

export {
  synthesizeModVoiceLineBuffers,
  type SynthesizeModVoiceLineBuffersResult,
  type SynthesizeModVoiceLineOptions,
} from './synthesizeModVoiceLineBuffers';

export type SynthesizeModVoiceLineResult =
  | { ok: true; relPath: string; skipped: boolean }
  | {
      ok: false;
      reason: 'line_not_found' | 'no_translation' | 'no_localize_dir' | 'non_speech' | 'tts_failed';
      message: string;
    };

/** Synthesize one voiced line into `_localize_{hash}/{lang}/` as a localized take. */
export const synthesizeModVoiceLine = async (
  db: Tx,
  opts: SynthesizeModVoiceLineOptions & { localizeDir: string; force?: boolean },
): Promise<SynthesizeModVoiceLineResult> => {
  if (!opts.localizeDir) {
    return {
      ok: false,
      reason: 'no_localize_dir',
      message: 'Mod import localize directory not found',
    };
  }
  const sidecarExtensions = (opts.takes ?? FUZ_TAKES).sidecarExtensions;

  let currentTakeRel: string | null = null;
  const built = await synthesizeModVoiceLineBuffers(db, {
    ...opts,
    // Skip the TTS call entirely when the stored stamp already matches.
    skipIfCurrent: opts.force
      ? undefined
      : async (payloadVersion, takeRel) => {
          const storedVersion = await loadVoiceSynthesisVersion(
            db,
            opts.modId,
            opts.lineKey,
            opts.variant,
            opts.tgtLang,
            opts.speakerKey?.trim() || speakerKeyFromVoiceRelPath(takeRel),
            originFromVoiceRelPath(takeRel),
          );
          const current = isVoiceSynthesisCurrent(
            storedVersion,
            payloadVersion,
            takeOnDisk(toDiskPath(opts.localizeDir, takeRel), sidecarExtensions),
          );
          if (current) currentTakeRel = takeRel;
          return current;
        },
  });
  if (!built.ok) {
    if (built.reason === 'up_to_date' && currentTakeRel) {
      return { ok: true, relPath: currentTakeRel, skipped: true };
    }
    return {
      ok: false,
      reason:
        built.reason === 'line_not_found' ||
        built.reason === 'no_translation' ||
        built.reason === 'non_speech' ||
        built.reason === 'tts_failed'
          ? built.reason
          : 'tts_failed',
      message: built.message,
    };
  }

  const takeDest = toDiskPath(opts.localizeDir, built.takeRel);
  const speakerKey = opts.speakerKey?.trim() || speakerKeyFromVoiceRelPath(built.takeRel);
  const originPlugin = originFromVoiceRelPath(built.takeRel);
  const files = { ...built.reference, takePath: takeDest };
  /** Stamp the take just written and keep a copy in the reference voice store. */
  const recordTake = (): Promise<void> =>
    recordVoiceTake(db, files, {
      modId: opts.modId,
      lineKey: opts.lineKey,
      variant: opts.variant,
      speakerKey,
      originPlugin,
      targetLang: opts.tgtLang,
      ttsTextVersion: built.payloadVersion,
      voiceSimilarity: built.voiceSimilarity,
    });
  const baselinePath = fs.existsSync(takeDest) ? takeDest : null;
  if (!opts.force && writeVoiceTakeIfChanged(takeDest, built.take, baselinePath)) {
    await recordTake();
    return { ok: true, relPath: built.takeRel, skipped: false };
  }
  if (opts.force) {
    writeVoiceTake(takeDest, built.take);
    await recordTake();
    return { ok: true, relPath: built.takeRel, skipped: false };
  }
  return { ok: true, relPath: built.takeRel, skipped: true };
};
