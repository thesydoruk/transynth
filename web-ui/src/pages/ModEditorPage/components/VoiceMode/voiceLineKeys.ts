import type { VoiceLinePreview } from '../../../../api';

export type PlayKind = 'source' | 'translation';

export const lineKey = (line: VoiceLinePreview): string =>
  `${line.speakerKey}:${line.lineKey}:${line.variant}`;

export const playTrackKey = (kind: PlayKind, line: VoiceLinePreview): string =>
  `${kind}:${lineKey(line)}`;
