/**
 * The vocal-effort choice of the regenerate review: a person hears a line with
 * and without its tag, and the take they keep must carry the stamp the batch
 * job would compute — so keeping it stores the choice as the line's override.
 */
import type { Tx } from '../../db';
import type { EffortTag } from '../../voice/vocalEffort';
import {
  loadClipEffort,
  saveEffortTagOverride,
  type ClipEffortTake,
} from '../../voice/voiceEffortStore';
import { normalizeVoiceOrigin } from '../../voice/voiceOrigin';
import { normalizeVoiceSpeakerKey } from '../../voice/voiceSynthesisState';
import {
  effortOverrideOfChoice,
  effortTagOfChoice,
  voiceEffortTagsStateFor,
  type VoiceEffortChoice,
} from './preview/voiceLineEffort';

/** What a preview remembers of its choice, enough to store it when kept. */
export type VoiceRegenerateEffort = {
  choice: VoiceEffortChoice;
  speakerKey: string;
  originPlugin: string;
};

/**
 * The tag to synthesize a preview with under a choice, or null when the choice
 * does not apply: none was made, or the game has tags off — then no path sends
 * a tag, and a take stamped with one would look stale forever.
 */
export const resolveRegenerateEffort = async (
  db: Tx,
  modId: number,
  game: string,
  choice: VoiceEffortChoice | undefined,
  take: Partial<ClipEffortTake> & Pick<ClipEffortTake, 'lineKey' | 'variant'>,
): Promise<{ effortTag: EffortTag | null; effort: VoiceRegenerateEffort } | null> => {
  const speakerKey = normalizeVoiceSpeakerKey(take.speakerKey);
  if (!choice || !speakerKey) return null;
  if (!(await voiceEffortTagsStateFor(db, game)).active) return null;
  const originPlugin = normalizeVoiceOrigin(take.originPlugin);
  // "Auto" is the analysis's tag, not the line's current override.
  const stored = await loadClipEffort(db, modId, { ...take, speakerKey, originPlugin });
  return {
    effortTag: effortTagOfChoice(choice, stored.tag),
    effort: { choice, speakerKey, originPlugin },
  };
};

/** Store the choice a kept preview was made under as the line's override. */
export const keepRegenerateEffort = async (
  db: Tx,
  modId: number,
  lineKey: string,
  variant: number,
  effort: VoiceRegenerateEffort | undefined,
): Promise<void> => {
  if (!effort) return;
  await saveEffortTagOverride(
    db,
    modId,
    { speakerKey: effort.speakerKey, lineKey, variant, originPlugin: effort.originPlugin },
    effortOverrideOfChoice(effort.choice),
  );
};
