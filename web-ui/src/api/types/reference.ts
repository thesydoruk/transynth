/** One row of the per-game reference base (mod-independent translations). */
export type ReferenceTranslation = {
  id: number;
  game: string;
  src_lang: string;
  tgt_lang: string;
  formid_hex: string;
  path: string;
  edid: string;
  signature: string | null;
  source_text: string;
  translation: string;
  origin: 'manual' | 'promote' | 'delete_snapshot' | 'auto_approve' | string;
  origin_mod_name: string | null;
  origin_mod_version: string | null;
  origin_status: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ReferenceListResult = { rows: ReferenceTranslation[]; total: number };

export type ReferencePromoteResult = { ok: boolean; promoted: number };
