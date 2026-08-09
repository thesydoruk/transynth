/**
 * Soft cost for mapping when character / library F0 are known.
 * Absolute Hz difference; missing either side → fixed soft penalty.
 */
export const f0Distance = (characterF0Hz: number | null, voiceF0Hz: number | null): number => {
  if (
    characterF0Hz == null ||
    voiceF0Hz == null ||
    !Number.isFinite(characterF0Hz) ||
    !Number.isFinite(voiceF0Hz)
  ) {
    return 25;
  }
  return Math.abs(characterF0Hz - voiceF0Hz);
};
