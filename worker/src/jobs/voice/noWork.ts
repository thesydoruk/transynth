/**
 * The voice job fails with one of these messages when a mod has nothing to
 * synthesize. In the editor that answer is useful; a Vortex run that voices a
 * whole group treats it as "nothing to do" for that mod, not as a failure.
 */
export const NO_MISSING_VOICE_LINES = 'No missing or stale voice lines to synthesize';

export const noLowSimilarityTakes = (below: number): string =>
  `No takes scored below ${below} to re-synthesize`;

export const isVoiceNoWorkError = (message: string | null | undefined): boolean =>
  message != null &&
  (message.startsWith(NO_MISSING_VOICE_LINES) ||
    /^No takes scored below \S+ to re-synthesize/.test(message));
