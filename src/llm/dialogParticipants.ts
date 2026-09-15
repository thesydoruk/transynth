/**
 * Dialog participant fields shared by the translate and verify payloads.
 *
 * English source text never says whether a speaker is male or female, while
 * Ukrainian needs it for every past-tense verb, so the pipeline resolves both
 * participants up front and hands them to the model alongside the text.
 */
import type { DialogLineParticipants } from '../dialog';

/**
 * Grammatical gender of a dialog participant, as the model sees it.
 *
 * `any` marks the player character, whose gender is chosen in-game: the line
 * must read correctly either way. `unknown` means detection failed, which for
 * a Ukrainian target calls for exactly the same hedging as `any` — so it is
 * sent rather than omitted. A field that is *absent* means the line is not
 * dialog and has no such participant at all.
 */
export type LlmParticipantGender = 'male' | 'female' | 'any' | 'unknown';

export type LlmDialogParticipants = {
  speaker?: string | null;
  speaker_gender?: LlmParticipantGender;
  addressee?: string | null;
  addressee_gender?: LlmParticipantGender;
};

/**
 * Copy the participant fields of an item into another payload.
 *
 * Used when a second pass rebuilds the item: whatever the first pass decided to
 * send is carried over verbatim, including an explicit `unknown`.
 */
export const participantPayloadFields = (item: LlmDialogParticipants): LlmDialogParticipants => ({
  ...(item.speaker != null ? { speaker: item.speaker } : {}),
  ...(item.speaker_gender != null ? { speaker_gender: item.speaker_gender } : {}),
  ...(item.addressee != null ? { addressee: item.addressee } : {}),
  ...(item.addressee_gender != null ? { addressee_gender: item.addressee_gender } : {}),
});

export type LlmParticipantPayloadOptions = {
  /**
   * True for lines spoken by someone to someone — an INFO record. Non-dialog
   * text (an item name, a terminal entry) has no addressee, and naming one
   * would invite the model to invent a conversation.
   */
  isDialogueLine: boolean;
};

/**
 * Map resolved dialog participants into the LLM item payload shape.
 *
 * On a dialog line both genders are always sent, because "we do not know" is
 * itself an instruction. Off a dialog line only a resolved narrator gender is
 * worth the tokens.
 */
export const buildLlmParticipantPayload = (
  participants: DialogLineParticipants,
  options: LlmParticipantPayloadOptions,
): LlmDialogParticipants => {
  if (!options.isDialogueLine) {
    if (participants.speakerGender === 'unknown') return {};
    return {
      ...(participants.speakerName ? { speaker: participants.speakerName } : {}),
      speaker_gender: participants.speakerGender,
    };
  }

  return {
    ...(participants.speakerName ? { speaker: participants.speakerName } : {}),
    speaker_gender: participants.speakerGender,
    ...(participants.addresseeName ? { addressee: participants.addresseeName } : {}),
    addressee_gender: participants.addresseeGender,
  };
};
