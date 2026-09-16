/**
 * Speaker gender model shared by import, translation, validation and voicing.
 *
 * Bethesda dialog records say who speaks (INFO\ANAM → an NPC_ record) but the
 * text itself carries no grammatical gender, which English does not need and
 * Ukrainian does. Gender is therefore resolved once per speaker during import
 * and travels with every line from there.
 */

/**
 * Grammatical gender to use for a dialog participant.
 *
 * `any` is not "unspecified": it marks a participant whose gender the player
 * picks at runtime (the Sole Survivor, the Dragonborn), so the line has to read
 * correctly for either gender. `unknown` means detection failed.
 */
export type SpeakerGender = 'male' | 'female' | 'any' | 'unknown';

const GENDERS: readonly SpeakerGender[] = ['male', 'female', 'any', 'unknown'];

/** Where a resolved gender came from, in descending order of trust. */
export type GenderSource =
  /** Female flag of the NPC_ ACBS subrecord. */
  | 'plugin'
  /** Voice type or voice folder name, e.g. `FemaleBoston`, `NPCMDanse`. */
  | 'voice_type'
  /** Female flag of the VTYP DNAM byte, for names that say nothing. */
  | 'voice_type_flag'
  /** Creation Kit naming pattern with no explicit gender, e.g. CrFeralGhoul. */
  | 'voice_type_heuristic'
  /** Pronouns the rest of the mod uses about this character, in the source language. */
  | 'pronoun_evidence'
  /** The player character, whose gender is chosen in-game. */
  | 'player'
  /** Set by a human in the speakers editor. */
  | 'manual';

/** Who a line is addressed to. */
export type AddresseeKind = 'player' | 'npc' | 'unknown';

/** Speaker key of the player character; the same for every mod. */
export const PLAYER_SPEAKER_KEY = 'player';

/**
 * Speaker key for an NPC identified by an ANAM actor reference.
 *
 * Keys are namespaced because quest-alias dialog has no ANAM and can only be
 * attributed to a voice folder, so both kinds of speaker share one table.
 */
export const npcSpeakerKey = (formIdHex: string): string => `npc:${formIdHex.toUpperCase()}`;

/** Speaker key for a speaker known only by their `Sound/Voice/<Plugin>/` folder. */
export const voiceFolderSpeakerKey = (folderName: string): string => `voice:${folderName}`;

/** Narrow an untrusted value to a {@link SpeakerGender}, defaulting to `unknown`. */
export const parseSpeakerGender = (value: unknown): SpeakerGender =>
  typeof value === 'string' && GENDERS.includes(value as SpeakerGender)
    ? (value as SpeakerGender)
    : 'unknown';

/** True when the gender is concrete enough to pick gendered wording. */
export const isDefiniteGender = (gender: SpeakerGender): gender is 'male' | 'female' =>
  gender === 'male' || gender === 'female';

/** One stored speaker, as persisted in `dialog_speakers`. */
export type SpeakerGenderRecord = {
  is_player: boolean;
  detected_gender: string | null;
  gender_override: string | null;
};

/** SQL expression computing {@link effectiveSpeakerGender} for a joined `dialog_speakers` alias. */
export const effectiveSpeakerGenderSql = (alias: string): string =>
  `COALESCE(
     NULLIF(${alias}.gender_override, ''),
     NULLIF(NULLIF(${alias}.detected_gender, ''), 'unknown'),
     CASE WHEN ${alias}.is_player THEN 'any' END,
     'unknown'
   )`;

/** Speaker and addressee of one translatable dialog line. */
export type DialogLineParticipants = {
  speakerName: string | null;
  speakerGender: SpeakerGender;
  addresseeName: string | null;
  addresseeGender: SpeakerGender;
};

/** Player-facing label used wherever the participant is the player character. */
const PLAYER_LABEL = 'Player';

/**
 * Resolve who says a line and to whom.
 *
 * An INFO record holds both halves of an exchange: `RNAM` is the prompt the
 * player picks and `NAM1` is the reply, so the same node yields opposite
 * speaker/addressee pairs depending on which subrecord the line came from.
 *
 * A player-voiced node is the awkward case: the player is on the speaking side
 * of both halves, so the counterpart has to come from the node's resolved
 * addressee. Without that the line reads as the player talking to themselves,
 * and a translator told both sides are `any` hedges the whole sentence.
 *
 * @param opts.isPlayerPrompt - True for the half of a record the player speaks.
 * @param opts.playerGender - What the protagonist's gender resolves to: `any`
 * where the player picks it, a definite gender where the game writes them.
 */
export const resolveDialogLineParticipants = (opts: {
  isPlayerPrompt: boolean;
  playerGender: SpeakerGender;
  nodeSpeakerName: string | null;
  nodeSpeakerGender: SpeakerGender;
  /** True when the node's own speaker is the player character. */
  nodeSpeakerIsPlayer: boolean;
  addresseeKind: AddresseeKind;
  addresseeName: string | null;
  addresseeGender: SpeakerGender;
}): DialogLineParticipants => {
  // Topic dialog and companion idles rarely name the listener. An NPC line
  // with no counterpart is spoken to the player — same default as import.
  const implicitPlayer =
    opts.addresseeKind === 'unknown' &&
    !opts.addresseeName &&
    !opts.nodeSpeakerIsPlayer &&
    !opts.isPlayerPrompt;

  const counterpart =
    opts.addresseeKind === 'player' || implicitPlayer
      ? { name: PLAYER_LABEL, gender: opts.playerGender }
      : { name: opts.addresseeName, gender: opts.addresseeGender };

  if (opts.isPlayerPrompt) {
    return {
      speakerName: PLAYER_LABEL,
      speakerGender: opts.playerGender,
      addresseeName: opts.nodeSpeakerIsPlayer ? counterpart.name : opts.nodeSpeakerName,
      addresseeGender: opts.nodeSpeakerIsPlayer ? counterpart.gender : opts.nodeSpeakerGender,
    };
  }

  return {
    speakerName: opts.nodeSpeakerIsPlayer ? PLAYER_LABEL : opts.nodeSpeakerName,
    speakerGender: opts.nodeSpeakerGender,
    addresseeName: counterpart.name,
    addresseeGender: counterpart.gender,
  };
};
