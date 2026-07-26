import type { DialogLineParticipants } from '../../../dialog';
import { narratorToSpeakerGender, parseNarratorGender } from '../../../dialog/narratorGender';

/** Apply record-level narrator gender when dialog metadata is absent. */
export const mergeNarratorGender = (
  participants: DialogLineParticipants,
  narratorGender: string | null | undefined,
  signature: string | null,
): DialogLineParticipants => {
  if (signature === 'INFO') return participants;
  if (participants.speakerGender !== 'unknown') return participants;

  const mapped = narratorToSpeakerGender(parseNarratorGender(narratorGender));
  if (!mapped) return participants;

  return { ...participants, speakerGender: mapped };
};
