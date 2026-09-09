/** Same floors as fish_studio `VOICE_RETRY_BELOW` / `VOICE_WARN_BELOW`. */
export const VOICE_SIMILARITY_FAIL = 0.25;
export const VOICE_SIMILARITY_WARN = 0.3;

export type VoiceSimilarityTone = 'fail' | 'warn' | 'ok';

export const voiceSimilarityTone = (score: number): VoiceSimilarityTone => {
  if (score < VOICE_SIMILARITY_FAIL) return 'fail';
  if (score < VOICE_SIMILARITY_WARN) return 'warn';
  return 'ok';
};

export const formatVoiceSimilarity = (score: number): string => score.toFixed(2);
