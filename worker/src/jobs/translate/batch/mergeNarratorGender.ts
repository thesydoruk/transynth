import type { DialogLineParticipants } from '../../../../../src/dialog';
import {
  narratorToSpeakerGender,
  parseNarratorGender,
} from '../../../../../src/dialog/narratorGender';

/**
 * Apply record-level narrator gender when dialog metadata is absent.
 *
 * A spoken line already has a resolved speaker, or a deliberate `unknown` that
 * means "nobody could tell" — guessing from the prose would overwrite both. So
 * this only fills in narration: a terminal entry, a note, a book.
 *
 * @param isSpokenLine - Whether the game calls this record a spoken line.
 */
export const mergeNarratorGender = (
  participants: DialogLineParticipants,
  narratorGender: string | null | undefined,
  isSpokenLine: boolean,
): DialogLineParticipants => {
  if (isSpokenLine) return participants;
  if (participants.speakerGender !== 'unknown') return participants;

  const mapped = narratorToSpeakerGender(parseNarratorGender(narratorGender));
  if (!mapped) return participants;

  return { ...participants, speakerGender: mapped };
};
