import type { VoiceRegeneratePreview } from '../../../../api';

export type CompareTrack =
  | { kind: 'source' }
  | { kind: 'current' }
  | { kind: 'preview'; preview: VoiceRegeneratePreview };

export const compareTrackKey = (track: CompareTrack): string => {
  if (track.kind === 'source') return 'source';
  if (track.kind === 'current') return 'current';
  return `preview:${track.preview.id}`;
};
