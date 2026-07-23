import { BASE } from './client';

export const voiceAudioUrl = (modId: number, formidLower6: string, variant: number): string =>
  `${BASE}/api/mods/${modId}/voice/audio/${formidLower6}/${variant}`;

export const voiceTranslationAudioUrl = (
  modId: number,
  formidLower6: string,
  variant: number,
): string => `${BASE}/api/mods/${modId}/voice/translation-audio/${formidLower6}/${variant}`;

export const voiceRegeneratePreviewUrl = (
  modId: number,
  sessionId: string,
  previewId: string,
): string => `${BASE}/api/mods/${modId}/voice/regenerate/${sessionId}/${previewId}.wav`;
