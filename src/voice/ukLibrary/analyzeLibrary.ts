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
 * Measure quality + detect gender (F0) for every library clip.
 * Preserves curated opentts genders; fills/overrides only non-curated rows.
 */
export const analyzeUkVoiceLibrary = async (db: Tx): Promise<AnalyzeUkVoiceLibraryResult> => {
  const voices = await listUkVoiceLibrary(db);
  let analyzed = 0;
  let genderUpdated = 0;
  let failed = 0;

  for (const voice of voices) {
    const abs = ukVoiceAudioAbsPath(voice.audioRelPath);
    try {
      const result = analyzeUkVoiceWav(abs);
      const preserveGender = voice.genderSource === 'curated' || voice.source === 'opentts';
      const nextGender = preserveGender ? voice.gender : result.gender;
      const nextGenderSource = preserveGender
        ? (voice.genderSource ?? 'curated')
        : result.gender === 'unknown'
          ? 'detected_uncertain'
          : 'detected';

      if (!preserveGender && nextGender !== voice.gender) genderUpdated += 1;

      await db.query(
        `UPDATE uk_voice_library
         SET gender = $2,
             quality_score = $3,
             gender_source = $4,
             mean_f0_hz = $5,
             analyzed_at = NOW(),
             meta = COALESCE(meta, '{}'::jsonb) || $6::jsonb
         WHERE id = $1`,
        [
          voice.id,
          nextGender,
          result.qualityScore,
          nextGenderSource,
          result.meanF0Hz,
          JSON.stringify({
            genderConfidence: result.genderConfidence,
            analysis: 'f0_autocorr_v1',
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

  log.info(
    `uk voice analyze done: analyzed=${analyzed}, genderUpdated=${genderUpdated}, failed=${failed}`,
  );
  return { analyzed, genderUpdated, failed };
};
