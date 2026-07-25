import type { CSSProperties } from 'react';

/** Deterministic hue so the same speaker keeps its colour across every view. */
const hueOf = (id: string): number => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return ((hash % 360) + 360) % 360;
};

/** Inline `--speaker-hue` custom property, or nothing when the speaker is unknown. */
export const speakerStyle = (id: string | null | undefined): CSSProperties | undefined =>
  id ? ({ '--speaker-hue': hueOf(id) } as CSSProperties) : undefined;
