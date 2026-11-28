import type {
  VoiceEffortChoice,
  VoiceEffortTag,
  VoiceLineEffort,
  VoiceLinePreview,
  VoiceSpeakerLinesResponse,
} from '../../../../api';
import { lineKey } from './voiceLineKeys';

/** Menu order: the analysis's decision first, then the hand-set ones. */
export const VOICE_EFFORT_CHOICES: readonly VoiceEffortChoice[] = [
  'auto',
  'shouting',
  'loud',
  'none',
];

/** The tag in force for a line; null when it has none (or the server predates tags). */
export const lineEffortTag = (line: VoiceLinePreview): VoiceEffortTag | null =>
  line.effortTag ?? null;

/** The choice a line is under now: its override, or the analysis's tag. */
export const currentEffortChoice = (line: VoiceLinePreview): VoiceEffortChoice =>
  line.effortOverride ?? 'auto';

/**
 * What the line's badge shows: its tag, a tag a person took away (kept visible,
 * since the analysis would have set one), or nothing but a quiet affordance.
 */
export type VoiceEffortBadgeView =
  | { kind: 'tag'; tag: VoiceEffortTag }
  | { kind: 'removed' }
  | { kind: 'empty' };

export const effortBadgeView = (line: VoiceLinePreview): VoiceEffortBadgeView => {
  const tag = lineEffortTag(line);
  if (tag) return { kind: 'tag', tag };
  if (line.effortOverride === 'none') return { kind: 'removed' };
  return { kind: 'empty' };
};

/** Strength the way the badge tooltip prints it. */
export const formatEffortStrength = (strength: number): string => strength.toFixed(2);

/** Put the server's answer for one line into the cached line list. */
export const patchVoiceLineEffort = (
  data: VoiceSpeakerLinesResponse | undefined,
  line: VoiceLinePreview,
  effort: VoiceLineEffort,
): VoiceSpeakerLinesResponse | undefined => {
  if (!data?.ok) return data;
  const key = lineKey(line);
  return {
    ...data,
    lines: data.lines.map((item) =>
      lineKey(item) === key
        ? {
            ...item,
            effortTag: effort.effortTag,
            effortAutoTag: effort.effortAutoTag,
            effortOverride: effort.effortOverride,
            effortStrength: effort.effortStrength,
          }
        : item,
    ),
  };
};
