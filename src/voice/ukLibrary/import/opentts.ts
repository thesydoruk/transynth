import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { mapWithConcurrency } from '../../../utils/concurrency';
import { analyzeUkVoiceWav } from '../analyzeClip';
import { upsertUkVoiceLibraryRow } from '../db';
import { ukVoiceAudioAbsPath, ukVoiceAudioRelPath, ukVoiceSourceDir } from '../paths';
import type { UkVoiceLibraryRow } from '../types';
import { cachedOpenttsClipPath, cacheOpenttsVoice, listCachedOpenttsClips } from './cacheOpentts';
import { createUkVoiceImportSemaphore, ukVoiceImportConcurrency } from './importConcurrency';
import { normalizeLocalReferenceClip } from './normalizeLocal';
import { OPENTTS_VOICES } from './openttsVoices';
import { selectBestClip, type ClipCandidate } from './selectBestClip';
import { isUsableTranscript } from './transcriptQuality';

export type ImportOpenttsResult = { count: number; ids: string[] };

/** Pick the best cached clip per opentts studio voice and write library winners. */
export const importOpenttsVoices = async (db: Tx): Promise<ImportOpenttsResult> => {
  ukVoiceSourceDir('opentts');

  // Full parquet download+extract per voice; run incomplete voices in parallel.
  await Promise.all(OPENTTS_VOICES.map((voice) => cacheOpenttsVoice(voice.slug, voice.dataset)));

  const concurrency = ukVoiceImportConcurrency();
  const semaphore = createUkVoiceImportSemaphore();
  const results = await mapWithConcurrency(OPENTTS_VOICES, concurrency, async (voice) => {
    const clips = listCachedOpenttsClips(voice.slug);
    const candidates: ClipCandidate[] = clips
      .filter((clip) => isUsableTranscript(clip.transcription))
      .map((clip) => ({
        id: String(clip.rowIdx),
        audioPath: cachedOpenttsClipPath(voice.slug, clip.fileName),
        durationSec: clip.duration,
        transcript: clip.transcription,
      }));

    const best = await selectBestClip(candidates, { semaphore });
    if (!best) {
      log.warn(`opentts: no usable clip for ${voice.displayName}`);
      return null;
    }

    const fileName = `${voice.slug}.wav`;
    const rel = ukVoiceAudioRelPath('opentts', fileName);
    const abs = ukVoiceAudioAbsPath(rel);
    await semaphore.run(async () => {
      await normalizeLocalReferenceClip(best.candidate.audioPath, abs);
    });
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
    log.info(`opentts: ${voice.displayName} → row ${best.candidate.id} Q=${analysis.qualityScore}`);
    return voice.id;
  });

  const ids = results.filter((id): id is string => id != null);
  return { count: ids.length, ids };
};
