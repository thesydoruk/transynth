/**
 * Dialog participant fields shared by the translate and verify payloads.
 *
 * English source text never says whether a speaker is male or female, while
 * Ukrainian needs it for every past-tense verb, so the pipeline resolves both
 * participants up front and hands them to the model alongside the text.
 */

/**
 * Grammatical gender of a dialog participant, as the model sees it.
 *
 * `any` marks the player character, whose gender is chosen in-game: the line
 * must read correctly either way. `unknown` means detection failed and the
 * model should fall back to neutral phrasing.
 */
export type LlmParticipantGender = 'male' | 'female' | 'any' | 'unknown';

export type LlmDialogParticipants = {
  speaker?: string | null;
  speaker_gender?: LlmParticipantGender;
  addressee?: string | null;
  addressee_gender?: LlmParticipantGender;
};

const hasGender = (gender: LlmParticipantGender | undefined): boolean =>
  gender != null && gender !== 'unknown';

/**
 * Keep participant fields out of the payload unless they say something.
 *
 * Non-dialog records have no participants at all, and an `unknown` gender adds
 * tokens without adding information.
 */
export const participantPayloadFields = (item: LlmDialogParticipants): LlmDialogParticipants => ({
  ...(item.speaker ? { speaker: item.speaker } : {}),
  ...(hasGender(item.speaker_gender) ? { speaker_gender: item.speaker_gender } : {}),
  ...(item.addressee ? { addressee: item.addressee } : {}),
  ...(hasGender(item.addressee_gender) ? { addressee_gender: item.addressee_gender } : {}),
});
