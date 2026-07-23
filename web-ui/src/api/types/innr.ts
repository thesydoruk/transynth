/**
 * One component row within an INNR naming rule group.
 *
 * Each row represents a single INNR FormID — one component slot (e.g. material,
 * quality, item type) within a compound naming rule.  Translators must see all
 * slots of the same rule together to maintain grammatical agreement.
 */
export type InnrRow = {
  string_id: number;
  formid_hex: string;
  /** Full EDID including numeric suffix, e.g. "ArmorMaterialSteel001". */
  edid: string | null;
  source: string;
  translation_id: number | null;
  translation: string | null;
  status: string | null;
  confidence: number | null;
  qa_issue_count: number;
};

/** A group of INNR rows sharing the same base EDID prefix. */
export type InnrGroup = {
  /** Base EDID without numeric suffix, e.g. "ArmorMaterialSteel". */
  base_edid: string;
  rows: InnrRow[];
};

/** Response from GET /api/mods/:modId/innr. */
export type InnrResult = {
  mod_id: number;
  mod_name: string;
  total_rows: number;
  groups: InnrGroup[];
};
