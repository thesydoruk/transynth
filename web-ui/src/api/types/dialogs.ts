export type DialogTopic = {
  topic_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_count: number;
};

export type DialogLineStatus =
  | 'draft'
  | 'reviewed'
  | 'rejected'
  | 'human'
  | 'fuzzy'
  | 'auto'
  | 'tm'
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
};

export type DialogTreeNode = {
  node_id: number;
  info_formid_hex: string;
  previous_info_formid_hex: string | null;
  speaker_formid_hex: string | null;
  speaker_name: string | null;
  lines: DialogLine[];
};

export type DialogTreeEdge = {
  edge_id: number;
  from_info_formid_hex: string;
  to_info_formid_hex: string;
  edge_kind: string;
  confidence: string;
};

export type DialogTreeResult = {
  nodes: DialogTreeNode[];
  edges: DialogTreeEdge[];
};

export type DialogScene = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  quest_formid_hex: string | null;
  phase_count: number;
};

export type DialogConversation = {
  conversation_key: string;
  quest_formid_hex: string | null;
  sample_scene_edid: string | null;
  sample_scene_formid_hex: string;
  scene_count: number;
  phase_count: number;
};

export type SceneDialogLine = {
  scene_id: number;
  scene_formid_hex: string;
  scene_edid: string | null;
  phase_order: number;
  alias_id: number;
  topic_formid_hex: string;
  topic_edid: string | null;
  node_id: number | null;
  info_formid_hex: string | null;
  speaker_name: string | null;
  /** Position of this INFO among the alternatives of its phase (1-based). */
  variant_index: number;
  /** How many alternative INFOs the phase offers. */
  variant_count: number;
  lines: DialogLine[];
};
