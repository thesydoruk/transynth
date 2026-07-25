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

/**
 * Gender that downstream consumers should use for a speaker.
 *
 * A human override always wins; the player is always `any` because their
 * gender is a runtime choice that no plugin data can pin down.
 */
export const effectiveSpeakerGender = (row: SpeakerGenderRecord): SpeakerGender => {
  const override = parseSpeakerGender(row.gender_override);
  if (override !== 'unknown') return override;
  if (row.is_player) return 'any';
  return parseSpeakerGender(row.detected_gender);
};

/** SQL expression computing {@link effectiveSpeakerGender} for a joined `dialog_speakers` alias. */
export const effectiveSpeakerGenderSql = (alias: string): string =>
  `COALESCE(
     NULLIF(${alias}.gender_override, ''),
     CASE WHEN ${alias}.is_player THEN 'any' END,
     NULLIF(${alias}.detected_gender, ''),
     'unknown'
   )`;

/** Speaker and addressee of one translatable dialog line. */
export type DialogLineParticipants = {
  speakerName: string | null;
  speakerGender: SpeakerGender;
  addresseeName: string | null;
  addresseeGender: SpeakerGender;
};

/**
 * Resolve who says a line and to whom.
 *
 * An INFO record holds both halves of an exchange: `RNAM` is the prompt the
 * player picks and `NAM1` is the reply, so the same node yields opposite
 * speaker/addressee pairs depending on which subrecord the line came from.
 *
 * @param opts.isPlayerPrompt - True for `INFO\RNAM` lines, which the player speaks.
 */
export const resolveDialogLineParticipants = (opts: {
  isPlayerPrompt: boolean;
  nodeSpeakerName: string | null;
  nodeSpeakerGender: SpeakerGender;
  addresseeKind: AddresseeKind;
  addresseeName: string | null;
  addresseeGender: SpeakerGender;
}): DialogLineParticipants => {
  if (opts.isPlayerPrompt) {
    return {
      speakerName: 'Player',
      speakerGender: 'any',
      addresseeName: opts.nodeSpeakerName,
      addresseeGender: opts.nodeSpeakerGender,
    };
  }

  return {
    speakerName: opts.nodeSpeakerName,
    speakerGender: opts.nodeSpeakerGender,
    addresseeName: opts.addresseeKind === 'player' ? 'Player' : opts.addresseeName,
    addresseeGender: opts.addresseeKind === 'player' ? 'any' : opts.addresseeGender,
  };
};
