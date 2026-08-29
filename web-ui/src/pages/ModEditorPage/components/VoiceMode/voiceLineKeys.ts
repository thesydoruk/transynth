import type { VoiceLinePreview } from '../../../../api';

export type PlayKind = 'source' | 'translation';

export const lineKey = (line: VoiceLinePreview): string =>
  `${line.speakerKey}:${line.formidLower6}:${line.variant}`;

export const playTrackKey = (kind: PlayKind, line: VoiceLinePreview): string =>
  `${kind}:${lineKey(line)}`;

export const speakerDubbedCount = (lines: VoiceLinePreview[]): number =>
  lines.filter((line) => line.hasTranslationAudio).length;
