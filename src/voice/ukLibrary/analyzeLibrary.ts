import type { Tx } from '../../db';
import { log } from '../../logger';
import { analyzeUkVoiceWav } from './analyzeClip';
import { listUkVoiceLibrary } from './db';
import { ukVoiceAudioAbsPath } from './paths';

export type AnalyzeUkVoiceLibraryResult = {
  analyzed: number;
  genderUpdated: number;
  failed: number;
};

/**
 * Re-score quality + F0 for library clips.
 * Does not change gender — gender comes from curated/CV metadata at import time.
 */
export const analyzeUkVoiceLibrary = async (db: Tx): Promise<AnalyzeUkVoiceLibraryResult> => {
  const voices = await listUkVoiceLibrary(db);
  let analyzed = 0;
  let failed = 0;

  for (const voice of voices) {
    const abs = ukVoiceAudioAbsPath(voice.audioRelPath);
    try {
      const result = analyzeUkVoiceWav(abs);
      await db.query(
        `UPDATE uk_voice_library
         SET quality_score = $2,
             mean_f0_hz = $3,
             analyzed_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $4::jsonb
         WHERE id = $1`,
        [
          voice.id,
          result.qualityScore,
          result.meanF0Hz,
          JSON.stringify({
            f0GenderHint: result.gender,
            genderConfidence: result.genderConfidence,
            reverbAmount: result.reverbAmount,
            analysis: 'f0_autocorr_v2_reverb',
          }),
        ],
      );
      analyzed += 1;
      if (analyzed % 50 === 0) {
        log.info(`uk voice analyze: ${analyzed}/${voices.length}`);
      }
    } catch (err) {
      failed += 1;
      log.warn(
        `uk voice analyze failed ${voice.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  log.info(`uk voice analyze done: analyzed=${analyzed}, failed=${failed}`);
  return { analyzed, genderUpdated: 0, failed };
};
