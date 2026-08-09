import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { analyzeUkVoiceWav } from '../analyzeClip';
import { upsertUkVoiceLibraryRow } from '../db';
import { ukVoiceAudioAbsPath, ukVoiceAudioRelPath, ukVoiceSourceDir } from '../paths';
import type { UkVoiceLibraryRow } from '../types';
import { cachedOpenttsClipPath, cacheOpenttsVoice, listCachedOpenttsClips } from './cacheOpentts';
import { normalizeLocalReferenceClip } from './normalizeLocal';
import { OPENTTS_VOICES } from './openttsVoices';
import { selectBestClip, type ClipCandidate } from './selectBestClip';

/** Pick the best cached clip per opentts studio voice and write library winners. */
export const importOpenttsVoices = async (db: Tx): Promise<number> => {
  ukVoiceSourceDir('opentts');
  let imported = 0;

  for (const voice of OPENTTS_VOICES) {
    await cacheOpenttsVoice(voice.slug, voice.dataset);
    const clips = listCachedOpenttsClips(voice.slug);
    const candidates: ClipCandidate[] = clips.map((clip) => ({
      id: String(clip.rowIdx),
      audioPath: cachedOpenttsClipPath(voice.slug, clip.fileName),
      durationSec: clip.duration,
      transcript: clip.transcription,
    }));

    const best = await selectBestClip(candidates);
    if (!best) {
      log.warn(`opentts: no usable clip for ${voice.displayName}`);
      continue;
    }

    const fileName = `${voice.slug}.wav`;
    const rel = ukVoiceAudioRelPath('opentts', fileName);
    const abs = ukVoiceAudioAbsPath(rel);
    await normalizeLocalReferenceClip(best.candidate.audioPath, abs);
    const analysis = analyzeUkVoiceWav(abs);

    const libraryRow: UkVoiceLibraryRow = {
      id: voice.id,
      source: 'opentts',
      displayName: voice.displayName,
      description: null,
      gender: voice.gender,
      age: 'thirties',
      audioRelPath: rel,
      transcript: best.candidate.transcript,
      license: voice.slug === 'kateryna' ? 'CC-BY-NC-4.0' : 'Apache-2.0',
      durationSec: best.candidate.durationSec,
      qualityScore: analysis.qualityScore,
      genderSource: 'curated',
      meanF0Hz: analysis.meanF0Hz,
      analyzedAt: new Date().toISOString(),
      speakerKey: voice.id,
      meta: {
        dataset: voice.dataset,
        rowIdx: Number(best.candidate.id),
        candidatesScored: best.candidatesScored,
      },
    };
    await upsertUkVoiceLibraryRow(db, libraryRow);
    imported += 1;
    log.info(`opentts: ${voice.displayName} → row ${best.candidate.id} Q=${analysis.qualityScore}`);
  }

  return imported;
};
