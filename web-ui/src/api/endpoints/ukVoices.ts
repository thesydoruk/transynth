import { BASE, req } from '../client';

export type UkVoiceGender = 'male' | 'female' | 'unknown';
export type UkVoiceSource = 'opentts' | 'common_voice';

export type UkVoiceLibraryItem = {
  id: string;
  source: UkVoiceSource;
  displayName: string;
  description: string | null;
  gender: UkVoiceGender;
  transcript: string;
  license: string;
  durationSec: number | null;
  qualityScore: number | null;
  genderSource: string | null;
  meanF0Hz: number | null;
  analyzedAt: string | null;
};

export type UkVoiceCharacter = {
  characterKey: string;
  displayName: string | null;
  gender: UkVoiceGender;
  modCount: number;
  lineCount: number;
  linkedVoiceId: string | null;
};

export const ukVoiceAudioUrl = (voiceId: string): string =>
  `${BASE}/api/uk-voices/${encodeURIComponent(voiceId)}/audio`;

export const ukVoicesEndpoints = {
  list: () => req<{ voices: UkVoiceLibraryItem[] }>('/api/uk-voices'),
  characters: () => req<{ characters: UkVoiceCharacter[] }>('/api/uk-voices/characters'),
  link: (characterKey: string, voiceId: string) =>
    req<{ ok: boolean }>(`/api/uk-voices/characters/${encodeURIComponent(characterKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ voiceId }),
    }),
  unlink: (characterKey: string) =>
    req<{ ok: boolean; removed: boolean }>(
      `/api/uk-voices/characters/${encodeURIComponent(characterKey)}`,
      { method: 'DELETE' },
    ),
  importLibrary: (maxVoices?: number) =>
    req<{ ok: boolean; opentts: number; commonVoice: number }>('/api/uk-voices/import', {
      method: 'POST',
      body: JSON.stringify(maxVoices != null ? { maxVoices } : {}),
    }),
  analyzeLibrary: () =>
    req<{ ok: boolean; analyzed: number; genderUpdated: number; failed: number }>(
      '/api/uk-voices/analyze',
      { method: 'POST', body: '{}' },
    ),
};
