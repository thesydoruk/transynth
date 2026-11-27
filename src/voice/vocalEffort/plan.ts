import { buildSpeakerBaseline, effortZScores, type SpeakerBaseline } from './baseline';
import { decideVocalEffort, hasEffortCue, type EffortDecision } from './decide';
import type { EffortFeatures } from './features';

/**
 * Vocal-effort decisions for all the clips of a mod at once.
 *
 * A clip is judged against its own speaker, so nothing can be decided one clip
 * at a time: first every speaker's calm baseline, then every line.
 *
 * A clip counts toward the baseline when its line is calm in all three ways —
 * a calm topic, no effort cue, and words to say. Each matters: on 8,030
 * Fallout 4 clips, of the shouted combat lines a baseline from calm topics
 * alone finds 40 %, without the cued lines 84 %, and without the wordless
 * ones (coughs, a crowd whistling) 93 %.
 */

/** One original clip with what is known about its line. */
export type EffortClip = {
  /** The caller's own key for the clip; decisions come back under it. */
  key: string;
  speakerKey: string;
  /** Null when the clip held too little speech to measure. */
  features: EffortFeatures | null;
  /** The game's data files the line under ordinary talk. */
  calmTopic: boolean;
  /** The line has words the TTS text rules would synthesize. */
  speakable: boolean;
  sourceText: string | null;
  actorNote: string | null;
};

/**
 * Calm clips a speaker needs before any of their lines is tagged.
 *
 * Fewer make a shaky baseline: against the tags a speaker's full baseline
 * gives (195 to 2,146 clips), one sampled down to 8 clips agrees on 85 % of
 * its tags, to 30 on 89 %, to 100 on 94 %. A speaker below the floor is left
 * untagged — pooling other voices in would judge a woman against men.
 */
export const MIN_TAGGING_BASELINE_CLIPS = 30;

const isBaselineClip = (clip: EffortClip): clip is EffortClip & { features: EffortFeatures } =>
  clip.features != null &&
  clip.calmTopic &&
  clip.speakable &&
  !hasEffortCue({ sourceText: clip.sourceText, scriptNote: clip.actorNote });

/** Baseline of every speaker with enough calm clips. */
export const buildSpeakerBaselines = (
  clips: readonly EffortClip[],
): Map<string, SpeakerBaseline> => {
  const calmBySpeaker = new Map<string, EffortFeatures[]>();
  for (const clip of clips) {
    if (!isBaselineClip(clip)) continue;
    const list = calmBySpeaker.get(clip.speakerKey) ?? [];
    list.push(clip.features);
    calmBySpeaker.set(clip.speakerKey, list);
  }
  const baselines = new Map<string, SpeakerBaseline>();
  for (const [speakerKey, calm] of calmBySpeaker) {
    const baseline = calm.length >= MIN_TAGGING_BASELINE_CLIPS ? buildSpeakerBaseline(calm) : null;
    if (baseline) baselines.set(speakerKey, baseline);
  }
  return baselines;
};

/**
 * The decision for every clip that can have one: a measured clip of a line
 * with words, said by a speaker with a baseline. The rest are absent, which
 * reads as "no tag".
 *
 * @example
 * planVocalEffort(clips).get('fallout4.esm/RaiderMale01:021B2A:1')?.tag; // 'shouting'
 */
export const planVocalEffort = (clips: readonly EffortClip[]): Map<string, EffortDecision> => {
  const baselines = buildSpeakerBaselines(clips);
  const decisions = new Map<string, EffortDecision>();
  for (const clip of clips) {
    const baseline = baselines.get(clip.speakerKey);
    if (!baseline || !clip.features || !clip.speakable) continue;
    decisions.set(
      clip.key,
      decideVocalEffort({
        acoustic: effortZScores(clip.features, baseline),
        sourceText: clip.sourceText,
        scriptNote: clip.actorNote,
      }),
    );
  }
  return decisions;
};
