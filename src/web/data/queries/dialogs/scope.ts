import type { AddresseeKind, SpeakerGender } from '../../../../dialog';
import type { DialogLine } from './lines';

/**
 * A dialog scope selects which kind of container the UI browses:
 *
 * - `topics` — one DIAL topic, rendered as a branching INFO tree.
 * - `branches` — one DLBR dialog branch: every topic it owns, sectioned.
 * - `scenes` — one SCEN scene, rendered as an ordered phase stream.
 * - `conversations` — every scene of one quest, stitched into a single stream.
 */
export type DialogScope = 'topics' | 'branches' | 'scenes' | 'conversations';

const SCOPES: readonly DialogScope[] = ['topics', 'branches', 'scenes', 'conversations'];

/** Narrow an untrusted query-string value to a {@link DialogScope}. */
export const parseDialogScope = (value: string | undefined): DialogScope | null =>
  SCOPES.includes(value as DialogScope) ? (value as DialogScope) : null;

/** One selectable container in the navigator list. */
export type DialogGroupRow = {
  /** Stable identifier: topic id, branch id, scene id, or conversation key. */
  key: string;
  /** Primary label — EDID when known, FormID otherwise. */
  label: string;
  /** Secondary label — FormID, quest, or scene count. */
  sublabel: string | null;
  /** INFO nodes (topics) or phases / topic trees (other scopes). */
  node_count: number;
  /** Translatable source lines inside the group. */
  line_count: number;
  /** Lines that already carry a non-empty translation. */
  translated_count: number;
  /** Lines with at least one active QA issue. */
  qa_count: number;
};

/** One speaker turn of a transcript. */
export type DialogEntryRow = {
  /** Unique within the transcript; used as a React key and focus anchor. */
  id: string;
  /** Indentation level — only branch points increase it. */
  depth: number;
  /** Section heading rendered above the entry (scene/topic name). */
  section: string | null;
  speaker: string | null;
  /** Key of the speaker in `dialog_speakers`; null when the node has no ANAM or voice folder. */
  speaker_key: string | null;
  /** Gender the speaker's lines must agree with. */
  speaker_gender: SpeakerGender;
  addressee_kind: AddresseeKind;
  addressee: string | null;
  addressee_gender: SpeakerGender;
  /** Scene alias the speaker is bound to; `-2` is the player. Null outside scenes. */
  alias_id: number | null;
  info_formid_hex: string | null;
  topic_formid_hex: string | null;
  /** Position among the conditioned alternatives of a scene phase (1-based). */
  variant_index: number;
  /** How many alternatives the phase offers. */
  variant_count: number;
  lines: DialogLine[];
};

/** Full payload of one selected group. */
export type DialogTranscriptRow = {
  scope: DialogScope;
  key: string;
  label: string;
  entries: DialogEntryRow[];
};
