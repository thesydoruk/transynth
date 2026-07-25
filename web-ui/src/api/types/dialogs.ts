/** Which kind of dialog container the editor is browsing. */
export type DialogScope = 'topics' | 'branches' | 'scenes' | 'conversations';

/**
 * Grammatical gender of a dialog participant.
 *
 * `any` marks the player character, whose gender is chosen in game, so their
 * lines have to read correctly either way. `unknown` means detection failed.
 */
export type SpeakerGender = 'male' | 'female' | 'any' | 'unknown';

/** Who a line is addressed to. */
export type AddresseeKind = 'player' | 'npc' | 'unknown';

/** One speaker of a mod, as shown in the speakers editor. */
export type DialogSpeaker = {
  speaker_key: string;
  display_name: string | null;
  voice_type: string | null;
  is_player: boolean;
  /** Gender resolved from plugin data during import. */
  detected_gender: SpeakerGender;
  detected_source:
    | 'plugin'
    | 'voice_type'
    | 'voice_type_flag'
    | 'voice_type_heuristic'
    | 'player'
    | 'manual'
    | null;
  /** Gender set by a human, which wins over detection. */
  gender_override: SpeakerGender | null;
  effective_gender: SpeakerGender;
  line_count: number;
};

export type DialogLineStatus =
  | 'draft'
  | 'reviewed'
  | 'rejected'
  | 'human'
  | 'fuzzy'
  | 'auto'
  | 'tm'
  | 'skip'
  | null;

/**
 * One translatable line of an INFO record: either a spoken response (NAM1) or
 * the prompt the player picks (RNAM). An INFO can hold several responses.
 */
export type DialogLine = {
  kind: 'response' | 'prompt';
  string_id: number;
  source: string;
  context: string | null;
  translation_id: number | null;
  translation: string | null;
  status: DialogLineStatus;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
  /**
   * Position of this response among the NAM1 lines of its INFO record, or null
   * for prompts. Together with the entry FormID it addresses the voice file.
   */
  voice_variant: number | null;
};

/** One selectable container in the navigator, with its translation progress. */
export type DialogGroup = {
  /** Topic id, scene id, or conversation key. */
  key: string;
  label: string;
  sublabel: string | null;
  /** INFO nodes (topics) or phases (scenes and conversations). */
  node_count: number;
  line_count: number;
  translated_count: number;
  qa_count: number;
};

/** One speaker turn of a transcript. */
export type DialogEntry = {
  id: string;
  /** Indentation level; only branch points in a topic tree increase it. */
  depth: number;
  /** Heading rendered above the entry, e.g. the scene name inside a conversation. */
  section: string | null;
  speaker: string | null;
  /** Key of the speaker in the speakers editor; null when the node names nobody. */
  speaker_key: string | null;
  /** Gender the speaker's lines must agree with. */
  speaker_gender: SpeakerGender;
  addressee_kind: AddresseeKind;
  addressee: string | null;
  addressee_gender: SpeakerGender;
  /** Scene alias of the speaker; `-2` is the player. Null outside scenes. */
  alias_id: number | null;
  info_formid_hex: string | null;
  topic_formid_hex: string | null;
  variant_index: number;
  variant_count: number;
  lines: DialogLine[];
};

/** Full dialog content of one selected group. */
export type DialogTranscript = {
  scope: DialogScope;
  key: string;
  label: string;
  entries: DialogEntry[];
};
