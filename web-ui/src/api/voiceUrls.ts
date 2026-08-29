import { BASE } from './client';

const appendQuery = (url: string, params: Record<string, string | undefined>): string => {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) search.set(name, trimmed);
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
};

export const voiceAudioUrl = (
  modId: number,
  formidLower6: string,
  variant: number,
  speakerKey?: string,
): string =>
  appendQuery(`${BASE}/api/mods/${modId}/voice/audio/${formidLower6}/${variant}`, {
    speakerKey,
  });

/** Dubbed take. Always cache-busted — regenerate overwrites the same path. */
export const voiceTranslationAudioUrl = (
  modId: number,
  formidLower6: string,
  variant: number,
  speakerKey?: string,
): string =>
  appendQuery(`${BASE}/api/mods/${modId}/voice/translation-audio/${formidLower6}/${variant}`, {
    speakerKey,
    t: String(Date.now()),
  });

export const voiceRegeneratePreviewUrl = (
  modId: number,
  sessionId: string,
  previewId: string,
): string =>
  appendQuery(`${BASE}/api/mods/${modId}/voice/regenerate/${sessionId}/${previewId}.wav`, {
    t: String(Date.now()),
  });
