/** audio-intel HTTP root (`GET /health`, `POST /v1/audio/transcriptions`). */
export const resolveAudioIntelBaseUrl = (): string => {
  const explicit = process.env.AUDIO_INTEL_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://localhost:8080';
};
