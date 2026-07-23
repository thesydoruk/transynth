import type { VoiceLinePreview } from '../../../../api';

export type PlayKind = 'source' | 'translation';

export const lineKey = (line: VoiceLinePreview): string => `${line.formidLower6}:${line.variant}`;

export const playTrackKey = (kind: PlayKind, line: VoiceLinePreview): string =>
  `${kind}:${lineKey(line)}`;

export const speakerHue = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
};
