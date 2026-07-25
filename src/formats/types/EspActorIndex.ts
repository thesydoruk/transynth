/** One NPC_ record, reduced to the fields that identify its speaker. */
export interface ActorRecord {
  /** FormID as 8-char uppercase hex. */
  formId: string;
  /** Editor ID, empty when absent. */
  edid: string;
  /** Female flag (bit 0) of the ACBS subrecord; null when ACBS is missing. */
  isFemale: boolean | null;
  /** VTYP voice type FormID, when the record references one. */
  voiceTypeFormId: string | null;
  /** FULL name as an lstring id, for localized plugins. */
  nameLStringId: number | null;
  /** FULL name as inline text, for non-localized plugins. */
  nameText: string | null;
}

/** One VTYP record; the editor id is the voice type name used by voice folders. */
export interface VoiceTypeRecord {
  formId: string;
  edid: string;
}

/** Actor-related records of one plugin, collected in a single walk. */
export interface EspActorIndex {
  actors: ActorRecord[];
  voiceTypes: VoiceTypeRecord[];
}
